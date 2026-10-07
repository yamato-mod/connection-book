import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { assertSameOrigin, requireMember, requireOrganizationManager } from "@/lib/server-auth";

const eventTypeSchema = z.enum(["regular", "guest", "external"]).default("regular");

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(200),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    location: z.string().max(300),
    description: z.string().max(5000),
    makeCurrent: z.boolean(),
    eventType: eventTypeSchema,
  }),
  z.object({
    action: z.literal("select"),
    localEventId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("delete"),
    eventId: z.string().uuid(),
  }),
  z.object({
    action: z.literal("update"),
    eventId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    location: z.string().max(300),
    description: z.string().max(5000),
    eventType: eventTypeSchema,
  }),
]);

const eventSelect =
  "id,name,description,starts_at,ends_at,location,is_current,all_day,event_type,event_contacts(contact:contacts(classification))";

export async function GET(request: Request) {
  try {
    const { member, supabase } = await requireMember(request);
    const url = new URL(request.url);
    const now = new Date();
    const timeMin = parseTime(url.searchParams.get("from"), new Date(now.getTime() - 30 * 86400000));
    const timeMax = parseTime(url.searchParams.get("to"), new Date(now.getTime() + 365 * 86400000));

    const result = await supabase
      .from("events")
      .select(eventSelect)
      .eq("club_id", member.club_id)
      .gte("starts_at", timeMin)
      .lte("starts_at", timeMax)
      .order("starts_at");

    if (result.error) throw result.error;

    return Response.json(
      {
        localEvents: result.data ?? [],
        selectedEventId: member.selected_event_id,
        canManage: member.access_role === "owner" || member.access_role === "admin",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const parsed = postSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: "invalid_input", message: "イベント情報を確認してください。" }, { status: 400 });

    const input = parsed.data;

    if (input.action === "select") {
      const selected = await supabase
        .from("members")
        .update({ selected_event_id: input.localEventId, updated_at: new Date().toISOString() })
        .eq("club_id", member.club_id)
        .eq("id", member.id);
      if (selected.error) throw selected.error;

      await supabase.from("audit_logs").insert({
        club_id: member.club_id,
        actor_member_id: member.id,
        action: "current_event_selected",
        entity_type: "event",
        entity_id: input.localEventId,
      });

      return Response.json({ ok: true, id: input.localEventId });
    }

    if (input.action === "delete") {
      requireOrganizationManager(member);

      // Clear selected_event_id for any member who had this event selected
      await supabase
        .from("members")
        .update({ selected_event_id: null, updated_at: new Date().toISOString() })
        .eq("club_id", member.club_id)
        .eq("selected_event_id", input.eventId);

      // Delete related event_contacts first
      await supabase
        .from("event_contacts")
        .delete()
        .eq("club_id", member.club_id)
        .eq("event_id", input.eventId);

      // Delete the event
      const deleted = await supabase
        .from("events")
        .delete()
        .eq("club_id", member.club_id)
        .eq("id", input.eventId);
      if (deleted.error) throw deleted.error;

      await supabase.from("audit_logs").insert({
        club_id: member.club_id,
        actor_member_id: member.id,
        action: "event_deleted",
        entity_type: "event",
        entity_id: input.eventId,
      });

      return Response.json({ ok: true });
    }

    if (input.action === "update") {
      requireOrganizationManager(member);
      if (new Date(input.endsAt) <= new Date(input.startsAt))
        return Response.json(
          { error: "invalid_event_range", message: "終了日時は開始日時より後にしてください。" },
          { status: 400 },
        );
      const updated = await supabase
        .from("events")
        .update({
          name: input.name,
          description: input.description,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          location: input.location,
          event_type: input.eventType,
        })
        .eq("club_id", member.club_id)
        .eq("id", input.eventId)
        .select("id");
      if (updated.error) throw updated.error;
      if (!updated.data?.length)
        return Response.json({ error: "not_found", message: "このイベントは削除されています。" }, { status: 404 });

      await supabase.from("audit_logs").insert({
        club_id: member.club_id,
        actor_member_id: member.id,
        action: "event_updated",
        entity_type: "event",
        entity_id: input.eventId,
      });
      return Response.json({ ok: true, id: input.eventId });
    }

    // action === "create"
    requireOrganizationManager(member);

    if (new Date(input.endsAt) <= new Date(input.startsAt))
      return Response.json(
        { error: "invalid_event_range", message: "終了日時は開始日時より後にしてください。" },
        { status: 400 },
      );

    const inserted = await supabase
      .from("events")
      .insert({
        club_id: member.club_id,
        name: input.name,
        description: input.description,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        location: input.location,
        is_current: false,
        created_by: member.id,
        calendar_source: "app",
        calendar_sync_status: "local",
        event_type: input.eventType,
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;

    if (input.makeCurrent) {
      const cleared = await supabase
        .from("events")
        .update({ is_current: false })
        .eq("club_id", member.club_id)
        .eq("is_current", true);
      if (cleared.error) throw cleared.error;

      const current = await supabase
        .from("events")
        .update({ is_current: true })
        .eq("club_id", member.club_id)
        .eq("id", inserted.data.id);
      if (current.error) throw current.error;

      await supabase
        .from("members")
        .update({ selected_event_id: inserted.data.id, updated_at: new Date().toISOString() })
        .eq("club_id", member.club_id)
        .eq("id", member.id);
    }

    await supabase.from("audit_logs").insert({
      club_id: member.club_id,
      actor_member_id: member.id,
      action: "event_created",
      entity_type: "event",
      entity_id: inserted.data.id,
    });

    return Response.json({ ok: true, id: inserted.data.id });
  } catch (error) {
    return apiError(error);
  }
}

function parseTime(value: string | null, fallback: Date) {
  if (!value) return fallback.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}
