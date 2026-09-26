import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { contactSchema, quickContactSchema } from "@/lib/domain";
import { createGoogleContact, findGoogleContactByEmail, uploadBusinessCard } from "@/lib/google";
import { assertSameOrigin, requireMember } from "@/lib/server-auth";

const metadataSchema = z.object({
  contact: contactSchema,
  classification: z.enum(["important", "courtesy", "undecided", "no_contact"]),
  eventId: z.string().uuid().nullable(),
  rawText: z.string().max(50000),
  ocrCorrected: z.boolean(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  quickMode: z.literal(false).optional(),
});

const quickMetadataSchema = z.object({
  contact: quickContactSchema,
  classification: z.literal("undecided"),
  eventId: z.string().uuid().nullable(),
  rawText: z.string().max(50000),
  ocrCorrected: z.boolean(),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  quickMode: z.literal(true),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const form = await request.formData();
    const image = form.get("image");
    const raw = JSON.parse(String(form.get("metadata") ?? "{}"));
    const parsed = raw.quickMode === true ? quickMetadataSchema.safeParse(raw) : metadataSchema.safeParse(raw);
    if (!(image instanceof File) || !image.type.startsWith("image/") || image.size > 10 * 1024 * 1024 || !parsed.success) {
      return Response.json({ error: "invalid_input", message: "名刺画像または入力内容を確認してください。" }, { status: 400 });
    }
    const input = parsed.data;
    const isQuick = "quickMode" in input && input.quickMode === true;
    if (input.eventId) {
      const event = await supabase.from("events").select("id").eq("club_id", member.club_id).eq("id", input.eventId).single();
      if (event.error) return Response.json({ error: "invalid_event", message: "選択中のイベントを確認してください。" }, { status: 409 });
    }
    const registration = await supabase.rpc("register_business_card_contact", {
      p_club_id: member.club_id,
      p_member_id: member.id,
      p_event_id: input.eventId,
      p_contact: { ...input.contact, classification: input.classification },
      p_ocr_raw_text: input.rawText,
      p_ocr_corrected: input.ocrCorrected,
      p_image_sha256: input.imageSha256,
      p_image_name: image.name || `business-card-${Date.now()}.jpg`,
      p_image_mime_type: image.type,
    });
    if (registration.error || !registration.data) throw registration.error ?? new Error("contact registration failed");
    const contactId = registration.data as string;
    await supabase.from("audit_logs").insert([{club_id:member.club_id,actor_member_id:member.id,action:"classification_selected",entity_type:"contact",entity_id:contactId,metadata:{classification:input.classification}},{club_id:member.club_id,actor_member_id:member.id,action:input.ocrCorrected?"ocr_corrected":"ocr_confirmed",entity_type:"contact",entity_id:contactId,metadata:{}}]);
    const statuses = { drive: "pending", people: "pending" };

    try {
      await supabase.from("business_cards").update({ drive_status: "processing", drive_error: null }).eq("club_id", member.club_id).eq("contact_id", contactId);
      const uploaded = await uploadBusinessCard(Buffer.from(await image.arrayBuffer()), `${input.contact.name}_${new Date().toISOString().slice(0, 10)}_${image.name}`, image.type);
      await Promise.all([
        supabase.from("business_cards").update({ image_google_file_id: uploaded.data.id, drive_status: "uploaded" }).eq("club_id", member.club_id).eq("contact_id", contactId),
        supabase.from("google_files").insert({ club_id: member.club_id, contact_id: contactId, google_file_id: uploaded.data.id, kind: "business_card", name: uploaded.data.name ?? image.name, web_view_link: uploaded.data.webViewLink }),
      ]);
      statuses.drive = "uploaded";
    } catch (error) {
      const message = safeError(error); statuses.drive = "failed";
      await supabase.from("business_cards").update({ drive_status: "failed", drive_error: message }).eq("club_id", member.club_id).eq("contact_id", contactId);
    }

    if (!isQuick && input.contact.email) {
      try {
        await supabase.from("contacts").update({ people_sync_status: "processing", people_sync_error: null }).eq("club_id", member.club_id).eq("id", contactId);
        const person = await findGoogleContactByEmail(input.contact.email) ?? await createGoogleContact(input.contact);
        await supabase.from("contacts").update({ people_sync_status: "synced", google_person_resource_name: person.resourceName }).eq("club_id", member.club_id).eq("id", contactId);
        statuses.people = "synced";
      } catch (error) {
        const message = safeError(error); statuses.people = "failed";
        await supabase.from("contacts").update({ people_sync_status: "failed", people_sync_error: message }).eq("club_id", member.club_id).eq("id", contactId);
      }
    } else { statuses.people = "skipped"; }
    return Response.json({ ok: true, contactId, statuses }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : "external service failed").slice(0, 1000);
}
