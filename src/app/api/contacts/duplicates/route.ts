import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { findDuplicates } from "@/lib/domain";
import { assertSameOrigin,requireMember } from "@/lib/server-auth";

const schema = z.object({ name: z.string().max(120), company: z.string().max(200), email: z.string().email(), phone: z.string().max(40) });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const input = schema.parse(await request.json());
    const normalizedPhone = input.phone.replace(/\D/g, "");
    const filters = [`email_normalized.eq.${input.email.toLowerCase()}`];
    if (normalizedPhone.length >= 7) filters.push(`phone_normalized.eq.${normalizedPhone}`);
    const result = await supabase.from("contacts").select("id,name,company_name,email,phone,email_logs(sent_at,sender:members!email_logs_sender_member_id_fkey(name),event:events(name))").eq("club_id", member.club_id).or(filters.join(",")).limit(20);
    if (result.error) throw result.error;
    const matches = findDuplicates(input, (result.data ?? []).map((row) => { const log=row.email_logs?.[0]; return { name: row.name, company: row.company_name, email: row.email ?? "", phone: row.phone, senderName: log?.sender?.[0]?.name, sentAt: log?.sent_at, eventName: log?.event?.[0]?.name }; }));
    return Response.json({ duplicates: matches });
  } catch (error) { return apiError(error); }
}
