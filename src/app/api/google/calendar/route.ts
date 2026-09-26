import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { createCalendarFollowup } from "@/lib/google";
import { assertSameOrigin, requireMember } from "@/lib/server-auth";

const schema = z.object({ followupId: z.string().uuid() });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const { followupId } = schema.parse(await request.json());
    const result = await supabase.from("followups").select("id,content,due_at,google_calendar_event_id,contact:contacts(name)").eq("club_id", member.club_id).eq("id", followupId).single();
    if (result.error) throw result.error;
    if (result.data.google_calendar_event_id) return Response.json({ ok: true, eventId: result.data.google_calendar_event_id, reused: true });
    await supabase.from("followups").update({ calendar_status: "processing", calendar_error: null }).eq("id", followupId).eq("club_id", member.club_id);
    try {
      const start = new Date(result.data.due_at); const end = new Date(start.getTime() + 30 * 60 * 1000);
      const contactName=result.data.contact?.[0]?.name;const created = await createCalendarFollowup({ summary: `${contactName ?? "連絡先"} — ${result.data.content}`, description: "つながり帳から登録", start: start.toISOString(), end: end.toISOString() });
      await supabase.from("followups").update({ calendar_status: "created", google_calendar_event_id: created.data.id }).eq("id", followupId).eq("club_id", member.club_id);
      await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"calendar_event_created",entity_type:"followup",entity_id:followupId,metadata:{google_calendar_event_id:created.data.id}});
      return Response.json({ ok: true, eventId: created.data.id });
    } catch (error) {
      await supabase.from("followups").update({ calendar_status: "failed", calendar_error: (error instanceof Error ? error.message : "calendar failed").slice(0, 1000) }).eq("id", followupId).eq("club_id", member.club_id);
      throw error;
    }
  } catch (error) { return apiError(error); }
}
