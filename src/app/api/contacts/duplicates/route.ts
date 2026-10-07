import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { findDuplicates } from "@/lib/domain";
import { assertSameOrigin,requireMember } from "@/lib/server-auth";
import { canEditContact } from "@/lib/organization-mail";

// email is optional so quick-mode cards (often photographed without an email) are checked too.
const schema = z.object({ name: z.string().max(120), company: z.string().max(200), email: z.union([z.literal(""), z.string().trim().toLowerCase().email()]), phone: z.string().max(40) });
const columns = "id,created_by,name,company_name,role,email,phone,address,website,email_logs(sent_at,sender:members!email_logs_sender_member_id_fkey(name),event:events(name))";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const input = schema.parse(await request.json());
    const normalizedPhone = input.phone.replace(/\D/g, "");
    const queries = [];
    if (input.email) queries.push(supabase.from("contacts").select(columns).eq("club_id", member.club_id).eq("email_normalized", input.email).limit(20));
    if (normalizedPhone.length >= 7) queries.push(supabase.from("contacts").select(columns).eq("club_id", member.club_id).eq("phone_normalized", normalizedPhone).limit(20));
    // Previously name+company was compared in findDuplicates but never fetched, so same-person cards without a shared email/phone slipped through.
    if (input.name.trim()) queries.push(supabase.from("contacts").select(columns).eq("club_id", member.club_id).ilike("name", namePattern(input.name)).limit(20));
    const results = await Promise.all(queries);
    for (const result of results) if (result.error) throw result.error;
    const rows = new Map(results.flatMap((result) => result.data ?? []).map((row) => [row.id, row]));
    const matches = findDuplicates(input, [...rows.values()].map((row) => { const log=row.email_logs?.[0]; return { id: row.id, canOverwrite: canEditContact(member, row), name: row.name, company: row.company_name, email: row.email ?? "", phone: row.phone, existing: { name: row.name, company: row.company_name, role: row.role, email: row.email ?? "", phone: row.phone, address: row.address, website: row.website }, senderName: log?.sender?.[0]?.name, sentAt: log?.sent_at, eventName: log?.event?.[0]?.name }; }));
    return Response.json({ duplicates: matches });
  } catch (error) { return apiError(error); }
}

/** "田中　美咲" and "田中 美咲" should match the same stored name: escape LIKE wildcards, let any whitespace run match anything. */
function namePattern(name: string) {
  return name.normalize("NFKC").trim().split(/\s+/).map((part) => part.replace(/[\\%_]/g, (c) => `\\${c}`)).join("%");
}
