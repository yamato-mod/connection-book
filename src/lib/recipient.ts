import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * お礼メールの宛先として認めるアドレスか。
 * 人物に登録されているメール、または「併記」で残した別の名刺のメール（メモ「メール: …」）なら認める。
 */
export async function isAllowedRecipient(supabase: SupabaseClient, clubId: string, contact: { id: string; email: string | null }, recipientEmail: string) {
  const email = recipientEmail.trim().toLowerCase();
  if (!email) return false;
  if ((contact.email ?? "").trim().toLowerCase() === email) return true;
  const escaped = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const note = await supabase.from("notes").select("id").eq("club_id", clubId).eq("contact_id", contact.id).ilike("body", `%メール: ${escaped}%`).limit(1);
  if (note.error) throw note.error;
  return (note.data ?? []).length > 0;
}
