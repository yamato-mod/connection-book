import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { backupClub } from "@/lib/backup";
import { assertSameOrigin, requireMember, requireOwner } from "@/lib/server-auth";

/** オーナー用：バックアップの状態を見る／今すぐバックアップする。 */
export const maxDuration = 300;

const schema = z.object({ action: z.enum(["status", "run"]) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { supabase, member } = await requireMember(request);
    requireOwner(member);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });

    if (parsed.data.action === "run") {
      // 連打防止：直近5分以内に手動で成功していたら断る（失敗した直後のやり直しは通す）
      const recent = await supabase.from("backup_runs").select("id").eq("club_id", member.club_id).eq("trigger", "manual").eq("status", "succeeded").gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).limit(1);
      if (recent.error) throw recent.error;
      if (recent.data?.length) return Response.json({ error: "too_soon", message: "さっきバックアップしたばかりです。5分ほど待ってからお試しください。" }, { status: 429 });
      const result = await backupClub(supabase, member.club_id, "manual");
      if (!result.ok) return Response.json({ error: result.code, message: result.message }, { status: 502 });
    }

    const runs = await supabase.from("backup_runs").select("trigger, status, file_name, bytes, row_count, error_message, created_at").eq("club_id", member.club_id).order("created_at", { ascending: false }).limit(5);
    if (runs.error) throw runs.error;
    return Response.json({ runs: runs.data ?? [], keyConfigured: Boolean(process.env.BACKUP_ENCRYPTION_KEY), scheduleConfigured: Boolean(process.env.CRON_SECRET) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
