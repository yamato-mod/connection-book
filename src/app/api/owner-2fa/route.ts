import crypto from "crypto";
import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { sendGmail } from "@/lib/google";
import { decryptGoogleToken } from "@/lib/google-token-crypto";
import { isGoogleReauthError } from "@/lib/organization-mail";
import { assertSameOrigin, ownerNeeds2FA, requireMember, requireOwner } from "@/lib/server-auth";

/**
 * オーナーの二段階認証。
 * - 認証コードは、部の組織Googleアカウント（Gmail）から、オーナーが登録した個人メールに送る。
 * - 確認済みかどうかはログイン（Supabaseの session_id）ごとに記録する。判定は server-auth の ownerNeeds2FA。
 * - コードは平文で保存しない。失敗が続いたら15分間ロックする。
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_SENDS = 5;

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_status") }),
  z.object({ action: z.literal("send_otp") }),
  z.object({ action: z.literal("verify_otp"), sessionId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("register_email"), personalEmail: z.string().trim().toLowerCase().email().max(320) }),
  z.object({ action: z.literal("confirm_email"), sessionId: z.string().uuid(), otp: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("remove_email") }),
]);

type Db = Awaited<ReturnType<typeof requireMember>>["supabase"];
type Member = Awaited<ReturnType<typeof requireMember>>["member"];

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // この画面で認証するので、認証前でも通す。オーナー以外は使えない。
    const { supabase, member, authSessionId } = await requireMember(request, { allowPendingOwner2FA: true });
    requireOwner(member);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "invalid_input", message: "入力が正しくありません。" }, 400);
    const input = parsed.data;
    if (!authSessionId) return json({ error: "invalid_session", message: "ログイン情報を確認できませんでした。ログインし直してください。" }, 401);

    const registered = await supabase.from("owner_2fa_emails").select("personal_email").eq("club_id", member.club_id).eq("member_id", member.id).maybeSingle();
    if (registered.error) throw registered.error;
    const personalEmail = registered.data?.personal_email ?? null;

    if (input.action === "get_status") {
      const pending = await ownerNeeds2FA(supabase, member, authSessionId);
      return json({ hasPersonalEmail: Boolean(personalEmail), maskedEmail: personalEmail ? maskEmail(personalEmail) : null, verified: !pending });
    }

    // 登録済みの個人メールを変える・外すのは、このログインで認証が済んでいるときだけ。
    if ((input.action === "register_email" || input.action === "confirm_email" || input.action === "remove_email") && personalEmail && await ownerNeeds2FA(supabase, member, authSessionId)) {
      return json({ error: "owner_2fa_required", message: "先に今の個人メールで認証してください。" }, 403);
    }

    if (input.action === "remove_email") {
      const removed = await supabase.from("owner_2fa_emails").delete().eq("club_id", member.club_id).eq("member_id", member.id);
      if (removed.error) throw removed.error;
      await audit(supabase, member, "owner_2fa_disabled");
      return json({ removed: true });
    }

    if (input.action === "send_otp" || input.action === "register_email") {
      const target = input.action === "send_otp" ? personalEmail : input.personalEmail;
      if (!target) return json({ error: "no_personal_email", message: "個人メールが登録されていません。設定画面から登録してください。" }, 400);
      if (await isLocked(supabase, member)) return locked();
      const recentSends = await supabase.from("owner_2fa_verifications").select("id", { count: "exact", head: true }).eq("member_id", member.id).neq("otp_hash", "").gte("created_at", new Date(Date.now() - LOCK_WINDOW_MS).toISOString());
      if (recentSends.error) throw recentSends.error;
      if ((recentSends.count ?? 0) >= MAX_SENDS) return json({ error: "too_many_sends", message: "認証コードの送信が多すぎます。15分ほど待ってから、もう一度お試しください。" }, 429);

      const purpose = input.action === "send_otp" ? "login" : "register_email";
      const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

      const sent = await sendCode(supabase, member, target, otp, purpose);
      if (sent) return sent;

      const created = await supabase.from("owner_2fa_verifications").insert({ club_id: member.club_id, member_id: member.id, session_id: sessionId, otp_hash: hashOtp(sessionId, otp), expires_at: expiresAt, purpose, target_email: target, auth_session_id: authSessionId });
      if (created.error) throw created.error;
      return json({ sessionId, expiresAt, maskedEmail: maskEmail(target) });
    }

    // verify_otp / confirm_email
    if (await isLocked(supabase, member)) return locked();
    const purpose = input.action === "verify_otp" ? "login" : "register_email";
    const found = await supabase.from("owner_2fa_verifications").select("id, otp_hash, expires_at, verified_at, target_email")
      .eq("session_id", input.sessionId).eq("member_id", member.id).eq("purpose", purpose).eq("auth_session_id", authSessionId).maybeSingle();
    if (found.error) throw found.error;
    const verification = found.data;
    if (!verification || verification.verified_at) return json({ error: "invalid_session", message: "この認証コードは使えません。もう一度コードを送信してください。" }, 400);
    if (new Date(verification.expires_at).getTime() < Date.now()) return json({ error: "expired", message: "認証コードの有効期限（10分）が切れました。もう一度送信してください。" }, 400);
    if (!sameHash(hashOtp(input.sessionId, input.otp), verification.otp_hash)) {
      await recordAttempt(supabase, member, false);
      const nowLocked = await isLocked(supabase, member);
      return json({ error: "invalid_otp", message: nowLocked ? "失敗が続いたため、15分間ロックしました。" : "認証コードが違います。" }, 400);
    }

    // 使い終わったコードは二度と使えないようにする（同時に2回送られても1回だけ通す）。
    const now = new Date().toISOString();
    const consumed = await supabase.from("owner_2fa_verifications").update({ verified_at: now }).eq("id", verification.id).is("verified_at", null).select("id");
    if (consumed.error) throw consumed.error;
    if (!consumed.data?.length) return json({ error: "invalid_session", message: "この認証コードは使えません。もう一度コードを送信してください。" }, 400);
    await recordAttempt(supabase, member, true);

    if (input.action === "confirm_email") {
      const saved = await supabase.from("owner_2fa_emails").upsert({ club_id: member.club_id, member_id: member.id, personal_email: verification.target_email, verified_at: now, updated_at: now }, { onConflict: "club_id" });
      if (saved.error) throw saved.error;
      // 登録に使ったこのログインは、そのまま認証済みとして扱う。
      const loginMark = await supabase.from("owner_2fa_verifications").insert({ club_id: member.club_id, member_id: member.id, session_id: crypto.randomUUID(), otp_hash: "", expires_at: now, verified_at: now, purpose: "login", auth_session_id: authSessionId });
      if (loginMark.error) throw loginMark.error;
      await audit(supabase, member, personalEmail ? "owner_2fa_email_changed" : "owner_2fa_enabled");
      return json({ registered: true, maskedEmail: maskEmail(verification.target_email ?? "") });
    }
    await audit(supabase, member, "owner_2fa_verified");
    return json({ verified: true });
  } catch (error) {
    return apiError(error);
  }
}

/** 組織Gmailから認証コードを送る。送れなかったときはエラーのレスポンスを返す。 */
async function sendCode(supabase: Db, member: Member, to: string, otp: string, purpose: "login" | "register_email") {
  const connection = await supabase.from("organization_google_connections").select("google_email, encrypted_refresh_token, status").eq("club_id", member.club_id).maybeSingle();
  if (connection.error) throw connection.error;
  if (!connection.data || connection.data.status !== "active") {
    return json({ error: "organization_google_not_connected", message: "組織Googleアカウントが接続されていないため、認証コードを送れません。" }, 409);
  }
  const subject = purpose === "login" ? "【つながり帳】オーナー認証コード" : "【つながり帳】個人メール登録の確認コード";
  const body = [
    `${member.name} さん`,
    "",
    purpose === "login" ? "つながり帳のオーナー認証コードです。" : "つながり帳の二段階認証に、このメールアドレスを登録するための確認コードです。",
    "",
    `認証コード：${otp}`,
    "",
    "有効期限は10分です。",
    "心当たりがない場合は、このメールを無視してください。誰かがオーナーのアカウントでログインしようとしている可能性があります。",
  ].join("\n");
  try {
    await sendGmail({ from: connection.data.google_email, to, subject, body, refreshToken: decryptGoogleToken(connection.data.encrypted_refresh_token) });
    return null;
  } catch (error) {
    console.error("Owner 2FA mail failed", error);
    if (isGoogleReauthError(error)) {
      await supabase.from("organization_google_connections").update({ status: "error" }).eq("club_id", member.club_id);
      return json({ error: "organization_google_reauth_required", message: "組織Googleアカウントの接続が切れているため、認証コードを送れません。" }, 409);
    }
    return json({ error: "send_failed", message: "認証コードのメールを送れませんでした。少し待ってから、もう一度お試しください。" }, 502);
  }
}

function hashOtp(sessionId: string, otp: string) {
  return crypto.createHash("sha256").update(`${sessionId}:${otp}`).digest("hex");
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  const visible = local.slice(0, Math.min(2, Math.max(1, local.length - 1)));
  return `${visible}${"*".repeat(Math.max(3, Math.min(local.length - visible.length, 6)))}@${domain}`;
}

async function isLocked(supabase: Db, member: Member) {
  const failures = await supabase.from("owner_2fa_attempts").select("id", { count: "exact", head: true }).eq("member_id", member.id).eq("success", false).gte("attempted_at", new Date(Date.now() - LOCK_WINDOW_MS).toISOString());
  if (failures.error) throw failures.error;
  return (failures.count ?? 0) >= MAX_FAILURES;
}

async function recordAttempt(supabase: Db, member: Member, success: boolean) {
  const result = await supabase.from("owner_2fa_attempts").insert({ club_id: member.club_id, member_id: member.id, success });
  if (result.error) throw result.error;
}

async function audit(supabase: Db, member: Member, action: string) {
  await supabase.from("audit_logs").insert({ club_id: member.club_id, actor_member_id: member.id, action, entity_type: "member", entity_id: member.id, metadata: {} });
}

function locked() {
  return json({ error: "rate_limited", message: "失敗が続いたため、15分間ロックしています。時間をおいてお試しください。" }, 429);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
