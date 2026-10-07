import { assertSameOrigin, requireMember } from "@/lib/server-auth";
import { isVisionConfigured, visionDocumentText, VisionOcrError } from "@/lib/vision-ocr";

// Business card images are sent to Google Cloud Vision only by signed-in members; nothing is stored here.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    if (!isVisionConfigured()) return Response.json({ error: "ocr_not_configured" }, { status: 503 });
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || !image.type.startsWith("image/") || image.size > 8 * 1024 * 1024) {
      return Response.json({ error: "invalid_input", message: "名刺画像を確認してください。" }, { status: 400 });
    }
    const text = await visionDocumentText(Buffer.from(await image.arrayBuffer()));
    await supabase.from("audit_logs").insert({ club_id: member.club_id, actor_member_id: member.id, action: "ocr_cloud_vision", entity_type: "business_card", metadata: { bytes: image.size } });
    return Response.json({ text, engine: "google-cloud-vision" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("cloud OCR failed", error);
    const status = error instanceof VisionOcrError && error.status === 503 ? 503 : 502;
    return Response.json({ error: "ocr_failed" }, { status });
  }
}
