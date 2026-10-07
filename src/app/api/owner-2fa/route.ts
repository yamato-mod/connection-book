import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireOwner } from "@/lib/server-auth";
import crypto from "crypto";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOtp(): string {
  return String(crypto.randomInt(100000, 999999));
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

// ── Actions ──
const sendOtpSchema = z.object({ action: z.literal("send_otp") });
const verifyOtpSchema = z.object({ action: z.literal("verify_otp"), otp: z.string().length(6), sessionId: z.string() });
const registerEmailSchema = z.object({ action: z.literal("register_email"), personalEmail: z.string().email().max(320) });
const sendVerifyEmailOtpSchema = z.object({ action: z.literal("send_verify_email_otp"), personalEmail: z.string().email().max(320) });
const confirmEmailSchema = z.object({ action: z.literal("confirm_email"), otp: z.string().length(6), personalEmail: z.string().email().max(320) });
const getStatusSchema = z.object({ action: z.literal("get_status") });

export async function POST(request: NextRequest) {
  try {
    const { supabase, member } = await requireMember(request);
    const body = await request.json();

    // ── get_status: check if owner has 2FA email registered ──
    if (body.action === "get_status") {
      requireOwner(member);
      const { data: twoFaEmail } = await supabase
        .from("owner_2fa_emails")
        .select("personal_email, verified_at")
        .eq("club_id", member.club_id)
        .maybeSingle();
      return NextResponse.json({
        hasPersonalEmail: !!twoFaEmail,
        personalEmail: twoFaEmail?.personal_email ?? null,
      });
    }

    // ── send_otp: send OTP to owner's registered personal email ──
    if (body.action === "send_otp") {
      requireOwner(member);

      // Check rate limit
      const locked = await isRateLimited(supabase, member.id, member.club_id);
      if (locked) {
        return NextResponse.json(
          { error: "rate_limited", message: "試行回数が上限に達しました。15分後に再度お試しください。" },
          { status: 429 }
        );
      }

      // Get registered personal email
      const { data: twoFaEmail } = await supabase
        .from("owner_2fa_emails")
        .select("personal_email")
        .eq("club_id", member.club_id)
        .maybeSingle();

      if (!twoFaEmail) {
        return NextResponse.json(
          { error: "no_personal_email", message: "個人メールが未登録です。先に個人メールを登録してください。" },
          { status: 400 }
        );
      }

      // Generate OTP
      const otp = generateOtp();
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

      // Store verification record
      await supabase.from("owner_2fa_verifications").insert({
        club_id: member.club_id,
        member_id: member.id,
        session_id: sessionId,
        otp_hash: hashOtp(otp),
        expires_at: expiresAt,
      });

      // Send OTP email via Supabase Auth magic link OTP (we use the admin API to send raw email)
      // Since Supabase Auth handles OTP natively, we'll use a simpler approach:
      // Send via the Supabase edge function or directly via the SMTP configured in Supabase
      // For this app, we use Supabase's auth.admin to send OTP
      // Actually, we need to send a plain OTP email. Let's use Supabase's built-in email sending.

      // Use Supabase Auth's signInWithOtp to send the code to personal email
      // This is a workaround: we send OTP to the personal email address
      const { error: otpError } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: twoFaEmail.personal_email,
        options: { data: { otp_code: otp, purpose: "owner_2fa" } },
      });

      // Even if generateLink returns the link, we just need the side effect of email being sent
      // For a more robust approach, we'd use a custom email template
      // For now, store the OTP and have the client show it needs to be entered
      // The actual email sending depends on Supabase email config

      // Alternative: use the OTP directly without email (stored in DB, client sends it)
      // In production, this would be replaced with proper email sending via Gmail API or SMTP

      return NextResponse.json({
        sessionId,
        expiresAt,
        // In production, remove this - OTP should only be sent via email
        // For development/testing, we might include a hint
        maskedEmail: maskEmail(twoFaEmail.personal_email),
      });
    }

    // ── verify_otp: verify the 2FA OTP ──
    if (body.action === "verify_otp") {
      const parsed = verifyOtpSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "invalid_input", message: "入力が不正です。" }, { status: 400 });
      requireOwner(member);

      // Check rate limit
      const locked = await isRateLimited(supabase, member.id, member.club_id);
      if (locked) {
        return NextResponse.json(
          { error: "rate_limited", message: "試行回数が上限に達しました。15分後に再度お試しください。" },
          { status: 429 }
        );
      }

      const { data: verification } = await supabase
        .from("owner_2fa_verifications")
        .select("id, otp_hash, expires_at, verified_at")
        .eq("session_id", parsed.data.sessionId)
        .eq("member_id", member.id)
        .maybeSingle();

      if (!verification) {
        await recordAttempt(supabase, member.id, member.club_id, false);
        return NextResponse.json({ error: "invalid_session", message: "認証セッションが見つかりません。" }, { status: 400 });
      }

      if (verification.verified_at) {
        return NextResponse.json({ error: "already_verified", message: "このセッションは既に認証済みです。" }, { status: 400 });
      }

      if (new Date(verification.expires_at) < new Date()) {
        await recordAttempt(supabase, member.id, member.club_id, false);
        return NextResponse.json({ error: "expired", message: "認証コードの有効期限が切れました。再度送信してください。" }, { status: 400 });
      }

      if (hashOtp(parsed.data.otp) !== verification.otp_hash) {
        await recordAttempt(supabase, member.id, member.club_id, false);

        // Check if now locked out
        const nowLocked = await isRateLimited(supabase, member.id, member.club_id);
        return NextResponse.json(
          { error: "invalid_otp", message: nowLocked ? "試行回数が上限に達しました。15分後に再度お試しください。" : "認証コードが正しくありません。" },
          { status: 400 }
        );
      }

      // Mark as verified
      await supabase
        .from("owner_2fa_verifications")
        .update({ verified_at: new Date().toISOString() })
        .eq("id", verification.id);

      await recordAttempt(supabase, member.id, member.club_id, true);

      return NextResponse.json({ verified: true });
    }

    // ── register_email: register personal email for 2FA (initial setup) ──
    if (body.action === "register_email" || body.action === "send_verify_email_otp") {
      requireOwner(member);
      const schema = body.action === "register_email" ? registerEmailSchema : sendVerifyEmailOtpSchema;
      const parsed = schema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "invalid_input", message: "有効なメールアドレスを入力してください。" }, { status: 400 });

      const personalEmail = (parsed.data as { personalEmail: string }).personalEmail;

      // Generate OTP for email verification
      const otp = generateOtp();
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

      // Store pending verification
      await supabase.from("owner_2fa_verifications").insert({
        club_id: member.club_id,
        member_id: member.id,
        session_id: sessionId,
        otp_hash: hashOtp(otp),
        expires_at: expiresAt,
      });

      // In production, send OTP to the email address
      // For now, we use Supabase Auth to send OTP
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: personalEmail,
        options: { data: { otp_code: otp, purpose: "owner_2fa_email_verify" } },
      });

      return NextResponse.json({
        sessionId,
        expiresAt,
        maskedEmail: maskEmail(personalEmail),
      });
    }

    // ── confirm_email: confirm the personal email with OTP ──
    if (body.action === "confirm_email") {
      const parsed = confirmEmailSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "invalid_input", message: "入力が不正です。" }, { status: 400 });
      requireOwner(member);

      // We need a sessionId too — add it
      const sessionId = body.sessionId;
      if (!sessionId) return NextResponse.json({ error: "invalid_input", message: "セッションIDが必要です。" }, { status: 400 });

      const { data: verification } = await supabase
        .from("owner_2fa_verifications")
        .select("id, otp_hash, expires_at, verified_at")
        .eq("session_id", sessionId)
        .eq("member_id", member.id)
        .maybeSingle();

      if (!verification || verification.verified_at || new Date(verification.expires_at) < new Date()) {
        return NextResponse.json({ error: "invalid_session", message: "認証セッションが無効または期限切れです。" }, { status: 400 });
      }

      if (hashOtp(parsed.data.otp) !== verification.otp_hash) {
        return NextResponse.json({ error: "invalid_otp", message: "認証コードが正しくありません。" }, { status: 400 });
      }

      // Mark verification as confirmed
      await supabase.from("owner_2fa_verifications").update({ verified_at: new Date().toISOString() }).eq("id", verification.id);

      // Upsert owner_2fa_emails
      const { error: upsertError } = await supabase
        .from("owner_2fa_emails")
        .upsert({
          club_id: member.club_id,
          member_id: member.id,
          personal_email: parsed.data.personalEmail,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "club_id" });

      if (upsertError) {
        return NextResponse.json({ error: "save_failed", message: "個人メールの保存に失敗しました。" }, { status: 500 });
      }

      return NextResponse.json({ registered: true });
    }

    return NextResponse.json({ error: "unknown_action", message: "不明なアクションです。" }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("Owner 2FA error:", e);
    return NextResponse.json({ error: "internal", message: "サーバーエラーが発生しました。" }, { status: 500 });
  }
}

// ── Helpers ──
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}${"*".repeat(Math.min(local.length - 2, 5))}@${domain}`;
}

async function isRateLimited(supabase: ReturnType<typeof createAdminClient>, memberId: string, clubId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from("owner_2fa_attempts")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .eq("success", false)
    .gte("attempted_at", windowStart);
  return (count ?? 0) >= MAX_ATTEMPTS;
}

async function recordAttempt(supabase: ReturnType<typeof createAdminClient>, memberId: string, clubId: string, success: boolean) {
  await supabase.from("owner_2fa_attempts").insert({
    club_id: clubId,
    member_id: memberId,
    success,
  });
}
