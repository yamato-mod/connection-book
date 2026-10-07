import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { sendGmail } from "@/lib/google";
import { decryptGoogleToken } from "@/lib/google-token-crypto";
import { assertSameOrigin } from "@/lib/server-auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ログイン用リンクを、Supabaseの標準メール（1時間に2通まで）ではなく、部の組織Gmailから送る。
 * - すでに部員の人：その部の組織Gmailから送る。
 * - はじめての人：組織コードを一緒に入れてもらい、その部の組織Gmailから送る。
 * - どちらでもない／組織Gmailが未接続：{ fallback: true } を返し、画面側でSupabaseの標準メールを使う。
 * リンクを受け取れるのはそのメールの持ち主だけなので、ログインできても承認されるまで何も見られない。
 */

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  inviteCode: z.string().trim().toUpperCase().max(12).optional().default(""),
});

const PER_EMAIL_INTERVAL_MS = 60 * 1000;
const PER_EMAIL_HOURLY = 5;
const PER_IP_HOURLY = 20;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return json({ error: "invalid_email", message: "メールアドレスの形を確認してください。" }, 400);
    const { email, inviteCode } = parsed.data;
    const supabase = createAdminClient();
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim().slice(0, 100) ?? "";

    // 送りすぎ防止（同じメールは1分あける・1時間5通まで、同じ通信元は1時間20通まで）
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const [byEmail, byIp] = await Promise.all([
      supabase.from("login_link_requests").select("created_at").eq("email", email).gte("created_at", hourAgo).order("created_at", { ascending: false }),
      ip ? supabase.from("login_link_requests").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", hourAgo) : Promise.resolve({ count: 0, error: null }),
    ]);
    if (byEmail.error) throw byEmail.error;
    if (byIp.error) throw byIp.error;
    const last = byEmail.data?.[0]?.created_at;
    if (last && Date.now() - new Date(last).getTime() < PER_EMAIL_INTERVAL_MS) {
      const wait = Math.ceil((PER_EMAIL_INTERVAL_MS - (Date.now() - new Date(last).getTime())) / 1000);
      return json({ error: "too_soon", message: `同じメールアドレスへの送信は少し間をあける必要があります。${wait}秒ほど待ってから、もう一度お試しください。` }, 429);
    }
    if ((byEmail.data?.length ?? 0) >= PER_EMAIL_HOURLY || (byIp.count ?? 0) >= PER_IP_HOURLY) {
      return json({ error: "too_many", message: "送信が多すぎます。しばらく待ってから、もう一度お試しください。" }, 429);
    }

    // 組織コードがあれば、その部。なければ、そのメールの人が所属している部。
    let clubId: string | null = null;
    if (inviteCode) {
      const club = await supabase.from("clubs").select("id").eq("invite_code", inviteCode).maybeSingle();
      if (club.error) throw club.error;
      if (!club.data) return json({ error: "invalid_code", message: "組織コードが見つかりません。コードを確認してください（はじめての人以外は空欄で大丈夫です）。" }, 404);
      clubId = club.data.id;
    }

    // リンクを作る（アカウントがなければ、ここで作られる。作られるだけで何も見られない）
    const link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const hashedToken = link.data.properties?.hashed_token;
    const userId = link.data.user?.id;
    if (!hashedToken || !userId) throw new Error("magic link was not generated");

    if (!clubId) {
      const member = await supabase.from("members").select("club_id").eq("auth_user_id", userId).neq("status", "withdrawn").limit(1).maybeSingle();
      if (member.error) throw member.error;
      clubId = member.data?.club_id ?? null;
    }
    if (!clubId) return json({ fallback: true });

    const connection = await supabase.from("organization_google_connections").select("google_email, encrypted_refresh_token, status").eq("club_id", clubId).maybeSingle();
    if (connection.error) throw connection.error;
    if (!connection.data || connection.data.status !== "active") return json({ fallback: true });

    const origin = new URL(request.url).origin;
    const next = `/start?intent=member${inviteCode ? `&code=${encodeURIComponent(inviteCode)}` : ""}`;
    const url = `${origin}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(next)}`;

    const recorded = await supabase.from("login_link_requests").insert({ email, ip });
    if (recorded.error) throw recorded.error;

    try {
      await sendGmail({
        from: connection.data.google_email,
        to: email,
        subject: "【つながり帳】ログイン用リンク",
        body: [
          "つながり帳のログイン用リンクです。下のリンクを開くとログインできます。",
          "",
          url,
          "",
          "このリンクは1回だけ使えます。有効期限は1時間です。",
          "心当たりがない場合は、このメールを無視してください。",
        ].join("\n"),
        refreshToken: decryptGoogleToken(connection.data.encrypted_refresh_token),
      });
    } catch (error) {
      // 組織Gmailで送れなかったときは、標準メールに切り替える。
      console.error("Login link via organization Gmail failed", error);
      return json({ fallback: true });
    }
    return json({ sent: true });
  } catch (error) {
    return apiError(error);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
