import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { requireUser, assertSameOrigin } from "@/lib/server-auth";

const schema = z.object({
  inviteCode: z.string().trim().toUpperCase().min(6).max(12),
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().max(120).default(""),
});

/**
 * POST /api/onboarding/join
 * Lets an authenticated user join an organization by invite code.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { supabase, user } = await requireUser(request);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        { error: "invalid_input", message: "入力内容を確認してください。" },
        { status: 400 },
      );

    const { inviteCode, name, title } = parsed.data;

    // Find the organization by invite code
    const { data: club, error: clubError } = await supabase
      .from("clubs")
      .select("id, name")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (clubError) throw clubError;
    if (!club)
      return Response.json(
        { error: "invalid_code", message: "組織コードが見つかりません。コードを確認してください。" },
        { status: 404 },
      );

    // 第7条: 招待コードでの入部は「申請」。代表または幹部が承認するまで何も見られない。
    const { data: existing } = await supabase
      .from("members")
      .select("id, status")
      .eq("club_id", club.id)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (existing?.status === "active" || existing?.status === "on_leave")
      return Response.json({ error: "already_member", message: "すでにこの団体に所属しています。" }, { status: 409 });
    if (existing?.status === "pending")
      return Response.json({ ok: true, pending: true, organizationName: club.name }, { headers: { "Cache-Control": "no-store" } });
    // 活動停止中の人が招待コードで自分の権限を戻すことはできない（第35・36条）。
    if (existing?.status === "suspended")
      return Response.json({ error: "membership_suspended", message: "現在、利用が一時停止されています。代表または副代表に確認してください。" }, { status: 403 });

    const application = {
      name,
      role: title,
      signature: `${name}\n${title}`.trim(),
      signature_display_name: name,
      access_role: "member",
      status: "pending",
      status_reason: "",
      contact_email: user.email ?? "",
      library_access: false,
      joined_at: null,
      left_at: null,
      updated_at: new Date().toISOString(),
    };
    // 退部した人の再入部も、もう一度承認を受ける（第11条）。
    const { error } = existing
      ? await supabase.from("members").update(application).eq("id", existing.id)
      : await supabase.from("members").insert({ ...application, club_id: club.id, auth_user_id: user.id });
    if (error) throw error;

    // Audit log
    await supabase.from("audit_logs").insert({
      club_id: club.id,
      actor_member_id: null,
      action: "member_join_requested",
      entity_type: "club",
      entity_id: club.id,
      metadata: { auth_user_id: user.id, invite_code: inviteCode },
    });

    return Response.json(
      { ok: true, pending: true, organizationName: club.name },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
