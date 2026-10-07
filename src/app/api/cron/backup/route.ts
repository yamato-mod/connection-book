import { backupClub } from "@/lib/backup";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 毎日の自動バックアップ（Vercel Cron から呼ばれる。vercel.json の crons）。
 * Vercel は CRON_SECRET を Authorization ヘッダーに付けて呼ぶので、それ以外は断る。
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createAdminClient();
  const connections = await supabase.from("organization_google_connections").select("club_id").eq("status", "active");
  if (connections.error) return Response.json({ error: "server_error" }, { status: 500 });
  const results = [];
  for (const { club_id } of connections.data ?? []) results.push({ clubId: club_id, ...(await backupClub(supabase, club_id, "scheduled")) });
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
