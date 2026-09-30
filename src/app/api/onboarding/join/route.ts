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

    // Check if already a member
    const { data: existing } = await supabase
      .from("members")
      .select("id, is_active")
      .eq("club_id", club.id)
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (existing?.is_active)
      return Response.json(
        { error: "already_member", message: "すでにこの団体に所属しています。" },
        { status: 409 },
      );

    // Re-activate if previously deactivated, otherwise create new member
    if (existing && !existing.is_active) {
      const { error } = await supabase
        .from("members")
        .update({
          name,
          role: title,
          signature: `${name}\n${title}`.trim(),
          signature_display_name: name,
          is_active: true,
          access_role: "member",
          is_admin: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("members").insert({
        club_id: club.id,
        auth_user_id: user.id,
        name,
        role: title,
        signature: `${name}\n${title}`.trim(),
        signature_display_name: name,
        access_role: "member",
        is_admin: false,
        is_active: true,
      });
      if (error) throw error;
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      club_id: club.id,
      actor_member_id: null,
      action: "member_self_joined",
      entity_type: "club",
      entity_id: club.id,
      metadata: { auth_user_id: user.id, invite_code: inviteCode },
    });

    return Response.json(
      { ok: true, organizationName: club.name },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
