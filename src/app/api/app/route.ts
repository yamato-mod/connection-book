import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { asAccessRole, assertSameOrigin, requireMember, requireOrganizationManager, requireOwner } from "@/lib/server-auth";
import { canEditContact, resolveSender, type MailSettings } from "@/lib/organization-mail";
import { canActOnMember, canSuspend, canViewContactDetails, isOfficer, limitContact, searchableText } from "@/lib/membership";
import { googleDrive } from "@/lib/google";
import { isConfiguredValue } from "@/lib/env-config";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_profile"), name: z.string().trim().min(1).max(120), role: z.string().trim().max(120), signature: z.string().max(4000) }),
  z.object({ action: z.literal("register_device"), deviceHash: z.string().length(64), label: z.string().max(120).default("") }),
  z.object({ action: z.literal("unregister_device"), deviceHash: z.string().length(64) }),
  z.object({ action: z.literal("select_event"), eventId: z.string().uuid().nullable() }),
  z.object({ action: z.literal("create_event"), name: z.string().trim().min(1).max(200), startsAt: z.string().datetime(), endsAt: z.string().datetime().nullable(), location: z.string().max(300), makeCurrent: z.boolean() }),
  z.object({ action: z.literal("complete_followup"), id: z.string().uuid(), done: z.boolean() }),
  z.object({ action: z.literal("create_followup"), contactId: z.string().uuid(), dueAt: z.string().datetime(), content: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("add_note"), contactId: z.string().uuid(), body: z.string().trim().min(1).max(3000) }),
  z.object({ action: z.literal("update_contact"), id: z.string().uuid(), name: z.string().trim().min(1).max(120), company: z.string().max(200), role: z.string().max(120), email: z.string().email(), phone: z.string().max(40), address: z.string().max(400), website: z.union([z.literal(""), z.string().url()]), classification: z.enum(["important","courtesy","undecided","no_contact"]) }),
  z.object({ action: z.literal("save_template"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(180), body: z.string().trim().min(1).max(20000), isDefault: z.boolean() }),
  z.object({ action:z.literal("delete_template"),id:z.string().uuid()}),
  z.object({ action:z.literal("delete_contact"),id:z.string().uuid()}),
  z.object({ action:z.literal("create_tag"),name:z.string().trim().min(1).max(80),color:z.string().regex(/^#[0-9a-fA-F]{6}$/)}),
  z.object({ action:z.literal("set_contact_tags"),contactId:z.string().uuid(),tagIds:z.array(z.string().uuid()).max(30)}),
  z.object({action:z.literal("update_organization"),name:z.string().trim().min(1).max(160)}),
  z.object({action:z.literal("update_mail_settings"),adminSenderMode:z.enum(["organization_email","personal_email","choosable"]),memberSenderMode:z.enum(["personal_email","organization_email"]),autoCcOrganizationEmail:z.boolean(),allowMemberToDisableCc:z.boolean()}),
  z.object({action:z.literal("invite_member"),email:z.string().trim().toLowerCase().email(),name:z.string().trim().min(1).max(120),title:z.string().trim().max(120),accessRole:z.enum(["admin","member"])}),
  z.object({action:z.literal("change_member_role"),memberId:z.string().uuid(),accessRole:z.enum(["admin","member"])}),
  z.object({action:z.literal("deactivate_member"),memberId:z.string().uuid()}),
  z.object({action:z.literal("transfer_owner"),memberId:z.string().uuid()}),
  z.object({action:z.literal("approve_member"),memberId:z.string().uuid()}),
  z.object({action:z.literal("reject_member"),memberId:z.string().uuid(),reason:z.string().trim().max(500).default("")}),
  z.object({action:z.literal("set_member_status"),memberId:z.string().uuid(),status:z.enum(["active","on_leave","suspended","withdrawn"]),reason:z.string().trim().max(500).default(""),suspendedUntil:z.string().datetime().nullable().default(null)}),
  z.object({action:z.literal("change_position"),memberId:z.string().uuid(),position:z.enum(["vice_representative","treasurer","executive","member"])}),
  z.object({action:z.literal("set_library_access"),memberId:z.string().uuid(),granted:z.boolean()}),
  z.object({action:z.literal("request_library_access"),reason:z.string().trim().min(1).max(500)}),
  z.object({action:z.literal("decide_library_access"),requestId:z.string().uuid(),approve:z.boolean(),note:z.string().trim().max(500).default("")}),
  z.object({action:z.literal("create_announcement"),title:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(5000),pinned:z.boolean().default(false)}),
  z.object({action:z.literal("update_announcement"),id:z.string().uuid(),title:z.string().trim().min(1).max(200),body:z.string().trim().min(1).max(5000),pinned:z.boolean().default(false)}),
  z.object({action:z.literal("delete_announcement"),id:z.string().uuid()}),
  z.object({action:z.literal("create_job_posting"),title:z.string().trim().min(1).max(200),company:z.string().max(200).default(""),body:z.string().trim().min(1).max(5000),hourlyRate:z.string().max(100).default(""),location:z.string().max(300).default(""),deadline:z.string().datetime().nullable().default(null),contactInfo:z.string().max(500).default("")}),
  z.object({action:z.literal("update_job_posting"),id:z.string().uuid(),title:z.string().trim().min(1).max(200),company:z.string().max(200).default(""),body:z.string().trim().min(1).max(5000),hourlyRate:z.string().max(100).default(""),location:z.string().max(300).default(""),deadline:z.string().datetime().nullable().default(null),contactInfo:z.string().max(500).default(""),isActive:z.boolean().default(true)}),
  z.object({action:z.literal("delete_job_posting"),id:z.string().uuid()}),
  z.object({action:z.literal("create_business_contest"),title:z.string().trim().min(1).max(200),organizer:z.string().max(200).default(""),body:z.string().trim().min(1).max(5000),url:z.string().max(2000).default(""),eventDate:z.string().datetime().nullable().default(null),deadline:z.string().datetime().nullable().default(null),location:z.string().max(300).default("")}),
  z.object({action:z.literal("update_business_contest"),id:z.string().uuid(),title:z.string().trim().min(1).max(200),organizer:z.string().max(200).default(""),body:z.string().trim().min(1).max(5000),url:z.string().max(2000).default(""),eventDate:z.string().datetime().nullable().default(null),deadline:z.string().datetime().nullable().default(null),location:z.string().max(300).default(""),isActive:z.boolean().default(true)}),
  z.object({action:z.literal("delete_business_contest"),id:z.string().uuid()}),
]);

export async function GET(request: Request) {
  try {
    const { member, supabase } = await requireMember(request);
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "dashboard";
    if (view === "dashboard") {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const tomorrow=new Date(today.getTime()+86400000),weekEnd=new Date(today.getTime()+7*86400000);
      const [contacts, important, undecided, followups, week, overdue, event] = await Promise.all([
        supabase.from("contacts").select("id,name,company_name,created_at").eq("club_id", member.club_id).order("created_at", { ascending: false }).limit(3),
        supabase.from("followups").select("id", { count: "exact", head: true }).eq("club_id", member.club_id).eq("status","open").eq("content","要手動対応"),
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("club_id", member.club_id).eq("classification", "undecided"),
        supabase.from("followups").select("id",{count:"exact",head:true}).eq("club_id", member.club_id).eq("status", "open").gte("due_at", today.toISOString()).lt("due_at",tomorrow.toISOString()),
        supabase.from("followups").select("id",{count:"exact",head:true}).eq("club_id",member.club_id).eq("status","open").gte("due_at",tomorrow.toISOString()).lt("due_at",weekEnd.toISOString()),
        supabase.from("followups").select("id",{count:"exact",head:true}).eq("club_id",member.club_id).eq("status","open").lt("due_at",today.toISOString()),
        member.selected_event_id ? supabase.from("events").select("id,name").eq("club_id",member.club_id).eq("id",member.selected_event_id).maybeSingle() : supabase.from("events").select("id,name").eq("club_id", member.club_id).eq("is_current", true).maybeSingle(),
      ]);
      throwFirst(contacts, important, undecided, followups,week,overdue,event);
      return Response.json({ member, currentEvent: event.data, recentContacts: contacts.data ?? [], tasks: { important: important.count ?? 0, undecided: undecided.count ?? 0, today: followups.count??0,week:week.count??0,overdue:overdue.count??0 } });
    }
    if (view === "contacts") {
      const search = (url.searchParams.get("q") ?? "").trim().toLocaleLowerCase("ja-JP");
      const [result, request] = await Promise.all([
        supabase.from("contacts").select("id,created_by,name,company_name,university_name,organization_name,role,email,phone,classification,last_contact_at,owner:members!contacts_owner_member_id_fkey(name),contact_tags(tags(name,color)),event_contacts(event:events(name,starts_at))").eq("club_id", member.club_id).order("last_contact_at", { ascending: false }).limit(500),
        supabase.from("library_access_requests").select("id,status,created_at").eq("member_id", member.id).eq("status", "pending").maybeSingle(),
      ]);
      throwFirst(result, request);
      // 権限のない部員には、他人が登録した名刺は人物名と所属だけを返す（連絡先は検索対象にも含めない）。
      const rows = (result.data ?? []).map((row) => { const full = canViewContactDetails(member, row); const { created_by: _createdBy, ...rest } = row; void _createdBy; return { full, row: full ? rest : limitContact(rest) }; });
      const contacts = (search ? rows.filter(({ row, full }) => searchableText(row, full).includes(search)) : rows).map(({ row }) => row);
      return Response.json({ contacts: contacts.slice(0, 100), canManage: isOfficer(member), libraryAccess: isOfficer(member) || Boolean(member.library_access), pendingLibraryRequest: Boolean(request.data) });
    }
    if (view === "contact") {
      const id = z.string().uuid().parse(url.searchParams.get("id"));
      const head = await supabase.from("contacts").select("id,created_by,name,company_name,university_name,organization_name").eq("club_id", member.club_id).eq("id", id).maybeSingle();
      throwFirst(head);
      if (!head.data) return Response.json({ error: "not_found", message: "この名刺は見つかりません。" }, { status: 404 });
      if (!canViewContactDetails(member, head.data)) {
        const request = await supabase.from("library_access_requests").select("id").eq("member_id", member.id).eq("status", "pending").maybeSingle();
        return Response.json({ restricted: true, contact: limitContact(head.data), pendingLibraryRequest: Boolean(request.data) }, { headers: { "Cache-Control": "no-store" } });
      }
      const emailQuery=supabase.from("email_logs").select("id,final_subject,final_body,recipient_email,actual_from_email,cc_emails,bcc_emails,sender_mode,status,error_message,sent_at,gmail_message_id,gmail_thread_id,sender_member_id").eq("club_id", member.club_id).eq("contact_id", id).order("created_at", { ascending: false });
      const [contact, notes, followups, emails, cards, events, tags, businessCards] = await Promise.all([
        supabase.from("contacts").select("*,owner:members!contacts_owner_member_id_fkey(name),contact_tags(tags(id,name,color))").eq("club_id", member.club_id).eq("id", id).single(),
        supabase.from("notes").select("id,body,created_at,author:members!notes_author_member_id_fkey(name)").eq("club_id", member.club_id).eq("contact_id", id).order("created_at", { ascending: false }),
        supabase.from("followups").select("*").eq("club_id", member.club_id).eq("contact_id", id).order("due_at"),
        member.access_role==="member"?emailQuery.eq("sender_member_id",member.id):emailQuery,
        supabase.from("google_files").select("id,name,web_view_link,created_at").eq("club_id", member.club_id).eq("contact_id", id),
        supabase.from("event_contacts").select("met_at,event:events(name,starts_at)").eq("club_id", member.club_id).eq("contact_id", id),
        supabase.from("tags").select("id,name,color").eq("club_id",member.club_id).order("name"),
        supabase.from("business_cards").select("id,drive_status,drive_error,image_name,image_mime_type,image_google_file_id").eq("club_id",member.club_id).eq("contact_id",id).order("captured_at",{ascending:false}),
      ]);
      throwFirst(contact, notes, followups, emails, cards, events,tags,businessCards);
      return Response.json({ canManage:member.access_role!=="member", canEdit:canEditContact(member,contact.data), contact: contact.data, notes: notes.data ?? [], followups: followups.data ?? [], emails: emails.data ?? [], files: cards.data ?? [], events: events.data ?? [],tags:tags.data??[],businessCards:businessCards.data??[] });
    }
    if (view === "events") {
      const result = await supabase.from("events").select("id,name,starts_at,ends_at,location,is_current,event_contacts(contact:contacts(classification)),email_logs(id)").eq("club_id", member.club_id).order("starts_at", { ascending: false });
      throwFirst(result); return Response.json({ events: result.data ?? [], selectedEventId: member.selected_event_id });
    }
    if (view === "followups") {
      const result = await supabase.from("followups").select("id,due_at,content,status,calendar_status,calendar_error,contact:contacts(id,name),assignee:members!followups_assigned_member_id_fkey(name)").eq("club_id", member.club_id).neq("status", "cancelled").order("due_at");
      throwFirst(result); return Response.json({ followups: result.data ?? [] });
    }
    if (view === "settings") {
      const manager=member.access_role==="owner"||member.access_role==="admin";
      const [devices, templates, jobs, club, mailSettings, members, organizationGoogle, userGoogle] = await Promise.all([
        supabase.from("devices").select("id,device_id_hash,label,last_seen_at,revoked_at,selected_event_id").eq("club_id", member.club_id).eq("member_id", member.id),
        supabase.from("email_templates").select("id,name,default_subject,default_body,is_default,is_active").eq("club_id", member.club_id).eq("is_active",true).order("name"),
        supabase.from("integration_jobs").select("operation,status,last_error,updated_at").eq("club_id", member.club_id).order("updated_at", { ascending: false }).limit(20),
        supabase.from("clubs").select("id,name,invite_code").eq("id",member.club_id).single(),
        supabase.from("organization_mail_settings").select("admin_sender_mode,member_sender_mode,auto_cc_organization_email,allow_member_to_disable_cc").eq("club_id",member.club_id).single(),
        manager?supabase.from("members").select("id,name,role,access_role,position,status,status_reason,status_changed_at,suspended_until,joined_at,left_at,contact_email,library_access,is_active,created_at").eq("club_id",member.club_id).order("created_at"):Promise.resolve({data:[],error:null}),
        // Every member needs the organization sender status (members may send from it or be auto-CC'd). Never select the token here.
        supabase.from("organization_google_connections").select("google_email,status,connected_at").eq("club_id",member.club_id).maybeSingle(),
        supabase.from("user_google_connections").select("google_email,status,connected_at").eq("club_id",member.club_id).eq("member_id",member.id).maybeSingle(),
      ]);
      throwFirst(devices, templates, jobs,club,mailSettings,members,organizationGoogle,userGoogle);
      const libraryRequests=manager?await supabase.from("library_access_requests").select("id,member_id,reason,created_at").eq("club_id",member.club_id).eq("status","pending").order("created_at"):{data:[],error:null};
      throwFirst(libraryRequests);
      const legacyGoogleConfigured = [process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REFRESH_TOKEN,process.env.GOOGLE_SHARED_GMAIL].every(isConfiguredValue);
      const oauthClientConfigured=[process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REDIRECT_URI,process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,process.env.GOOGLE_OAUTH_STATE_SECRET].every(isConfiguredValue);
      const sender=resolveSender({role:asAccessRole(member.access_role),settings:mailSettings.data as MailSettings,organizationGoogle:organizationGoogle.data,userGoogle:userGoogle.data});
      return Response.json({ member,sender,canSuspend:canSuspend(member),libraryRequests:libraryRequests.data??[],organization:club.data,mailSettings:mailSettings.data,members:members.data??[],organizationGoogle:organizationGoogle.data,userGoogle:userGoogle.data,oauthClientConfigured,devices: devices.data ?? [], templates: templates.data ?? [], jobs: jobs.data ?? [], integrations: { gmail: Boolean(organizationGoogle.data||userGoogle.data), drive: legacyGoogleConfigured, people: legacyGoogleConfigured, calendar: legacyGoogleConfigured } });
    }
    if (view === "bulletin") {
      const manager = member.access_role === "owner" || member.access_role === "admin";
      const [announcements, jobPostings, event] = await Promise.all([
        supabase.from("announcements").select("id,title,body,pinned,published_at,author:members!announcements_author_member_id_fkey(name)").eq("club_id", member.club_id).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(50),
        supabase.from("job_postings").select("id,title,company,body,hourly_rate,location,deadline,contact_info,is_active,published_at,author:members!job_postings_author_member_id_fkey(name)").eq("club_id", member.club_id).eq("is_active", true).order("published_at", { ascending: false }).limit(50),
        member.selected_event_id ? supabase.from("events").select("id,name,starts_at").eq("club_id", member.club_id).eq("id", member.selected_event_id).maybeSingle() : supabase.from("events").select("id,name,starts_at").eq("club_id", member.club_id).eq("is_current", true).maybeSingle(),
      ]);
      throwFirst(announcements, jobPostings);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const [undecidedCount, overdueCount] = await Promise.all([
        supabase.from("contacts").select("id", { count: "exact", head: true }).eq("club_id", member.club_id).eq("classification", "undecided"),
        supabase.from("followups").select("id", { count: "exact", head: true }).eq("club_id", member.club_id).eq("status", "open").lt("due_at", today.toISOString()),
      ]);
      // Check owner 2FA status
      let owner2faRequired = false;
      let owner2faHasEmail = false;
      if (member.access_role === "owner") {
        const { data: twoFaEmail } = await supabase.from("owner_2fa_emails").select("id").eq("club_id", member.club_id).maybeSingle();
        owner2faHasEmail = !!twoFaEmail;
        if (twoFaEmail) {
          const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: verified } = await supabase.from("owner_2fa_verifications").select("id").eq("member_id", member.id).not("verified_at", "is", null).gte("verified_at", windowStart).limit(1).maybeSingle();
          owner2faRequired = !verified;
        }
      }
      return Response.json({ member, canManage: manager, announcements: announcements.data ?? [], jobPostings: jobPostings.data ?? [], currentEvent: event?.data ?? null, statusSummary: { undecided: undecidedCount.count ?? 0, overdue: overdueCount.count ?? 0 }, owner2faRequired, owner2faHasEmail });
    }
    if (view === "business_contests") {
      const manager = member.access_role === "owner" || member.access_role === "admin";
      const showPast = url.searchParams.get("showPast") === "true";
      let query = supabase.from("business_contests").select("id,title,organizer,body,url,event_date,deadline,location,is_active,published_at,author:members!business_contests_author_member_id_fkey(name)").eq("club_id", member.club_id);
      if (!showPast) { query = query.or("deadline.is.null,deadline.gte." + new Date().toISOString()); }
      const result = await query.order("event_date", { ascending: true, nullsFirst: false }).limit(100);
      throwFirst(result);
      return Response.json({ businessContests: result.data ?? [], canManage: manager });
    }
    return Response.json({ error: "unknown_view" }, { status: 404 });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { member, supabase } = await requireMember(request);
    const parsed = mutationSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;
    if (input.action === "update_profile") {
      const result = await supabase.from("members").update({ name: input.name, role: input.role, signature: input.signature, signature_display_name: input.name, updated_at: new Date().toISOString() }).eq("id", member.id).eq("club_id", member.club_id); throwFirst(result);
      await audit(supabase,member,"member_profile_updated","member",member.id);
    } else if (input.action === "register_device") {
      const result = await supabase.from("devices").upsert({ club_id: member.club_id, member_id: member.id, device_id_hash: input.deviceHash, label: input.label, revoked_at: null, last_seen_at: new Date().toISOString() }, { onConflict: "club_id,device_id_hash" }); throwFirst(result);
      await audit(supabase,member,"device_registered","device",null);
    } else if (input.action === "unregister_device") {
      const result = await supabase.from("devices").update({ revoked_at: new Date().toISOString() }).eq("club_id", member.club_id).eq("member_id", member.id).eq("device_id_hash", input.deviceHash); throwFirst(result);
      await audit(supabase,member,"device_revoked","device",null);
    } else if (input.action === "select_event") {
      if (input.eventId) { const event = await supabase.from("events").select("id").eq("club_id", member.club_id).eq("id", input.eventId).single(); throwFirst(event); }
      const result = await supabase.from("members").update({ selected_event_id: input.eventId, updated_at:new Date().toISOString() }).eq("club_id", member.club_id).eq("id",member.id); throwFirst(result);
      await audit(supabase,member,"current_event_selected","event",input.eventId);
    } else if (input.action === "create_event") {
      requireOrganizationManager(member);
      if (input.endsAt && input.endsAt < input.startsAt) return Response.json({ error: "invalid_event_range", message: "終了日時は開始日時以降にしてください。" }, { status: 400 });
      if (input.makeCurrent) { const cleared = await supabase.from("events").update({ is_current: false }).eq("club_id", member.club_id).eq("is_current", true); throwFirst(cleared); }
      const result = await supabase.from("events").insert({ club_id: member.club_id, name: input.name, starts_at: input.startsAt, ends_at: input.endsAt, location: input.location, is_current: input.makeCurrent, created_by: member.id }).select("id").single(); throwFirst(result); await audit(supabase,member,"event_created","event",result.data!.id);return Response.json({ ok: true, id: result.data!.id });
    } else if (input.action === "complete_followup") {
      const result = await supabase.from("followups").update({ status: input.done ? "done" : "open", completed_at: input.done ? new Date().toISOString() : null }).eq("club_id", member.club_id).eq("id", input.id); throwFirst(result);
      await audit(supabase,member,input.done?"followup_completed":"followup_reopened","followup",input.id);
    } else if (input.action === "create_followup") {
      const result = await supabase.from("followups").insert({ club_id: member.club_id, contact_id: input.contactId, assigned_member_id: member.id, due_at: input.dueAt, content: input.content }).select("id").single(); throwFirst(result);await audit(supabase,member,"followup_created","followup",result.data!.id);return Response.json({ ok: true, id: result.data!.id });
    } else if (input.action === "add_note") {
      const result = await supabase.from("notes").insert({ club_id: member.club_id, contact_id: input.contactId, author_member_id: member.id, body: input.body }).select("id").single(); throwFirst(result);await audit(supabase,member,"note_added","note",result.data!.id);return Response.json({ ok: true, id: result.data!.id });
    } else if (input.action === "delete_contact") {
      requireOrganizationManager(member);
      const removed = await supabase.rpc("delete_contact", { p_club_id: member.club_id, p_member_id: member.id, p_contact_id: input.id });
      if (removed.error?.code === "P0002") return Response.json({ error: "not_found", message: "この名刺は既に削除されています。" }, { status: 404 });
      throwFirst(removed);
      // Card images in Drive go to the Drive trash (recoverable for 30 days). Best effort: the CRM record is already gone.
      const fileIds = (removed.data as string[] | null) ?? [];
      let driveTrashFailed = 0;
      if (fileIds.length) {
        try { const drive = googleDrive(); const results = await Promise.allSettled(fileIds.map((fileId) => drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true }))); driveTrashFailed = results.filter((r) => r.status === "rejected").length; }
        catch { driveTrashFailed = fileIds.length; }
      }
      return Response.json({ ok: true, driveFiles: fileIds.length, driveTrashFailed });
    } else if (input.action === "update_contact") {
      const target = await supabase.from("contacts").select("created_by").eq("club_id", member.club_id).eq("id", input.id).maybeSingle(); throwFirst(target);
      if (!target.data) return Response.json({ error: "not_found", message: "この名刺は削除されています。" }, { status: 404 });
      if (!canEditContact(member, target.data)) return Response.json({ error: "forbidden", message: "編集できるのは、この名刺を登録した人と管理者だけです。" }, { status: 403 });
      const result = await supabase.from("contacts").update({ name: input.name, company_name: input.company, role: input.role, email: input.email, phone: input.phone, phone_normalized: input.phone.replace(/\D/g, ""), address: input.address, website: input.website, classification: input.classification, updated_at: new Date().toISOString() }).eq("club_id", member.club_id).eq("id", input.id); throwFirst(result);
      await audit(supabase,member,"contact_updated","contact",input.id,{classification:input.classification});
    } else if (input.action === "save_template") {
      requireOrganizationManager(member);
      if (input.isDefault) { const cleared = await supabase.from("email_templates").update({ is_default: false }).eq("club_id", member.club_id).eq("is_default", true); throwFirst(cleared); }
      const record = { club_id: member.club_id, name: input.name, default_subject: input.subject, default_body: input.body, is_default: input.isDefault, is_active: true, created_by: member.id, updated_at: new Date().toISOString() };
      const result = input.id ? await supabase.from("email_templates").update(record).eq("club_id", member.club_id).eq("id", input.id) : await supabase.from("email_templates").insert(record); throwFirst(result);
      await audit(supabase,member,"email_template_saved","email_template",input.id??null);
    } else if(input.action==="delete_template"){
      requireOrganizationManager(member);
      const result=await supabase.from("email_templates").update({is_active:false,is_default:false,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);await audit(supabase,member,"email_template_deleted","email_template",input.id);
    } else if(input.action==="create_tag"){
      requireOrganizationManager(member);
      const result=await supabase.from("tags").upsert({club_id:member.club_id,name:input.name,color:input.color},{onConflict:"club_id,name"}).select("id").single();throwFirst(result);await audit(supabase,member,"tag_saved","tag",result.data!.id);return Response.json({ok:true,id:result.data!.id});
    } else if(input.action==="set_contact_tags"){
      if(input.tagIds.length){const owned=await supabase.from("tags").select("id").eq("club_id",member.club_id).in("id",input.tagIds);throwFirst(owned);if(owned.data?.length!==input.tagIds.length)return Response.json({error:"invalid_tags"},{status:403})}
      const removed=await supabase.from("contact_tags").delete().eq("club_id",member.club_id).eq("contact_id",input.contactId);throwFirst(removed);if(input.tagIds.length){const added=await supabase.from("contact_tags").insert(input.tagIds.map(tagId=>({club_id:member.club_id,contact_id:input.contactId,tag_id:tagId})));throwFirst(added)}await audit(supabase,member,"contact_tags_updated","contact",input.contactId,{tag_ids:input.tagIds});
    } else if(input.action==="update_organization"){
      requireOwner(member);const result=await supabase.from("clubs").update({name:input.name}).eq("id",member.club_id);throwFirst(result);await audit(supabase,member,"organization_updated","club",member.club_id,{name:input.name});
    } else if(input.action==="update_mail_settings"){
      requireOrganizationManager(member);const result=await supabase.from("organization_mail_settings").upsert({club_id:member.club_id,admin_sender_mode:input.adminSenderMode,member_sender_mode:input.memberSenderMode,auto_cc_organization_email:input.autoCcOrganizationEmail,allow_member_to_disable_cc:input.allowMemberToDisableCc,updated_by_member_id:member.id,updated_at:new Date().toISOString()},{onConflict:"club_id"});throwFirst(result);await audit(supabase,member,"mail_policy_updated","organization_mail_settings",member.club_id,{admin_sender_mode:input.adminSenderMode,member_sender_mode:input.memberSenderMode,auto_cc_organization_email:input.autoCcOrganizationEmail,allow_member_to_disable_cc:input.allowMemberToDisableCc});
    } else if(input.action==="invite_member"){
      requireOrganizationManager(member);if(member.access_role==="admin"&&input.accessRole!=="member")return Response.json({error:"owner_required"},{status:403});
      const listed=await supabase.auth.admin.listUsers({page:1,perPage:1000});if(listed.error)throw listed.error;let invited=listed.data.users.find(candidate=>candidate.email?.toLowerCase()===input.email);
      if(!invited){const result=await supabase.auth.admin.inviteUserByEmail(input.email,{redirectTo:`${process.env.NEXT_PUBLIC_APP_URL}/settings`});if(result.error)throw result.error;invited=result.data.user}
      const created=await supabase.from("members").insert({club_id:member.club_id,auth_user_id:invited.id,name:input.name,role:input.title,signature_display_name:input.name,signature:`${input.name}\n${input.title}`.trim(),access_role:input.accessRole,is_admin:input.accessRole==="admin",status:"active",joined_at:new Date().toISOString(),contact_email:input.email}).select("id").single();throwFirst(created);await audit(supabase,member,"member_added","member",created.data!.id,{access_role:input.accessRole});
    } else if(input.action==="change_member_role"){
      requireOwner(member);if(input.memberId===member.id)return Response.json({error:"use_owner_transfer"},{status:409});const changed=await supabase.from("members").update({access_role:input.accessRole,is_admin:input.accessRole==="admin",updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId).neq("access_role","owner");throwFirst(changed);await audit(supabase,member,"member_role_changed","member",input.memberId,{access_role:input.accessRole});
    } else if(input.action==="deactivate_member"){
      // 旧UIからの呼び出し。退部（第11条）として扱う。
      const target=await loadTarget(supabase,member,input.memberId);if(target instanceof Response)return target;
      await withdrawMember(supabase,member,input.memberId,"");
    } else if(input.action==="approve_member"){
      // 第7条: 代表又は権限を付与された幹部が承認し、名簿に登録する。
      requireOrganizationManager(member);
      const now=new Date().toISOString();
      const approved=await supabase.from("members").update({status:"active",status_reason:"",joined_at:now,left_at:null,updated_at:now}).eq("club_id",member.club_id).eq("id",input.memberId).eq("status","pending").select("id");throwFirst(approved);
      if(!approved.data?.length)return Response.json({error:"not_pending",message:"承認待ちの申請が見つかりません。"},{status:409});
      await audit(supabase,member,"member_approved","member",input.memberId);
    } else if(input.action==="reject_member"){
      requireOrganizationManager(member);
      const rejected=await supabase.from("members").update({status:"withdrawn",status_reason:input.reason||"入部申請を承認しませんでした",updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId).eq("status","pending").select("id");throwFirst(rejected);
      if(!rejected.data?.length)return Response.json({error:"not_pending",message:"承認待ちの申請が見つかりません。"},{status:409});
      await audit(supabase,member,"member_rejected","member",input.memberId,{reason:input.reason});
    } else if(input.action==="set_member_status"){
      const target=await loadTarget(supabase,member,input.memberId);if(target instanceof Response)return target;
      if(input.status==="suspended"){
        // 第35条: 一時制限は代表・副代表が理由を通知して30日以内。延長や活動停止（第36条）は幹部会の決議を記録する。
        if(!canSuspend(member))return Response.json({error:"forbidden",message:"活動停止・アクセス制限は代表または副代表が行います。"},{status:403});
        if(!input.reason)return Response.json({error:"reason_required",message:"本人に通知する理由を入力してください。"},{status:400});
        const until=input.suspendedUntil?new Date(input.suspendedUntil):new Date(Date.now()+30*86400000);
        if(until.getTime()<=Date.now())return Response.json({error:"invalid_until",message:"停止期限は未来の日付にしてください。"},{status:400});
        const changed=await supabase.from("members").update({status:"suspended",status_reason:input.reason,suspended_until:until.toISOString(),updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId);throwFirst(changed);
        await audit(supabase,member,"member_suspended","member",input.memberId,{reason:input.reason,until:until.toISOString()});
      }else if(input.status==="withdrawn"){
        await withdrawMember(supabase,member,input.memberId,input.reason);
      }else{
        // 休部・復部（第10条）。休部中も資格と議決権は残るので、ログインはできる。
        if(target.status==="pending"||target.status==="withdrawn")return Response.json({error:"invalid_transition",message:"承認待ち・退部済みの人は、承認または再入部の手続きをしてください。"},{status:409});
        const changed=await supabase.from("members").update({status:input.status,status_reason:input.reason,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId);throwFirst(changed);
        await audit(supabase,member,input.status==="on_leave"?"member_on_leave":"member_reinstated","member",input.memberId,{reason:input.reason});
      }
    } else if(input.action==="change_position"){
      // 第15条: 副代表・会計・幹部は代表が指名し幹部会で選任する。アプリ上の反映は代表が行う。
      requireOwner(member);if(input.memberId===member.id)return Response.json({error:"use_owner_transfer"},{status:409});
      const target=await supabase.from("members").select("access_role,status").eq("club_id",member.club_id).eq("id",input.memberId).single();throwFirst(target);
      if(target.data?.access_role==="owner")return Response.json({error:"use_owner_transfer"},{status:409});
      if(target.data?.status!=="active"&&target.data?.status!=="on_leave")return Response.json({error:"inactive_member",message:"在籍中の部員にだけ役職を付けられます。"},{status:409});
      const changed=await supabase.from("members").update({position:input.position,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId);throwFirst(changed);
      await audit(supabase,member,"member_position_changed","member",input.memberId,{position:input.position});
    } else if(input.action==="set_library_access"){
      requireOrganizationManager(member);
      const now=new Date().toISOString();
      const changed=await supabase.from("members").update(input.granted?{library_access:true,library_access_granted_by:member.id,library_access_granted_at:now,updated_at:now}:{library_access:false,library_access_granted_by:null,library_access_granted_at:null,updated_at:now}).eq("club_id",member.club_id).eq("id",input.memberId);throwFirst(changed);
      await audit(supabase,member,input.granted?"library_access_granted":"library_access_revoked","member",input.memberId);
    } else if(input.action==="request_library_access"){
      if(isOfficer(member)||member.library_access)return Response.json({error:"already_granted",message:"すでに名刺ライブラリの詳細を閲覧できます。"},{status:409});
      const created=await supabase.from("library_access_requests").insert({club_id:member.club_id,member_id:member.id,reason:input.reason});
      if(created.error?.code==="23505")return Response.json({error:"already_requested",message:"申請済みです。幹部の承認をお待ちください。"},{status:409});
      throwFirst(created);await audit(supabase,member,"library_access_requested","member",member.id);
    } else if(input.action==="decide_library_access"){
      requireOrganizationManager(member);
      const now=new Date().toISOString();
      const decided=await supabase.from("library_access_requests").update({status:input.approve?"approved":"rejected",decided_by:member.id,decided_at:now,decision_note:input.note}).eq("club_id",member.club_id).eq("id",input.requestId).eq("status","pending").select("member_id");throwFirst(decided);
      const requester=decided.data?.[0]?.member_id;if(!requester)return Response.json({error:"not_pending",message:"この申請はすでに処理されています。"},{status:409});
      if(input.approve){const granted=await supabase.from("members").update({library_access:true,library_access_granted_by:member.id,library_access_granted_at:now,updated_at:now}).eq("club_id",member.club_id).eq("id",requester);throwFirst(granted);}
      await audit(supabase,member,input.approve?"library_access_granted":"library_access_request_rejected","member",requester,{note:input.note});
    } else if(input.action==="transfer_owner"){
      requireOwner(member);const transferred=await supabase.rpc("transfer_organization_owner",{p_club_id:member.club_id,p_current_owner_id:member.id,p_new_owner_id:input.memberId});throwFirst(transferred);await audit(supabase,member,"owner_transferred","member",input.memberId,{previous_owner_id:member.id});
    } else if(input.action==="create_announcement"){
      requireOrganizationManager(member);
      const result=await supabase.from("announcements").insert({club_id:member.club_id,author_member_id:member.id,title:input.title,body:input.body,pinned:input.pinned}).select("id").single();throwFirst(result);
      await audit(supabase,member,"announcement_created","announcement",result.data!.id);return Response.json({ok:true,id:result.data!.id});
    } else if(input.action==="update_announcement"){
      requireOrganizationManager(member);
      const result=await supabase.from("announcements").update({title:input.title,body:input.body,pinned:input.pinned,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"announcement_updated","announcement",input.id);
    } else if(input.action==="delete_announcement"){
      requireOrganizationManager(member);
      const result=await supabase.from("announcements").delete().eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"announcement_deleted","announcement",input.id);
    } else if(input.action==="create_job_posting"){
      requireOrganizationManager(member);
      const result=await supabase.from("job_postings").insert({club_id:member.club_id,author_member_id:member.id,title:input.title,company:input.company,body:input.body,hourly_rate:input.hourlyRate,location:input.location,deadline:input.deadline,contact_info:input.contactInfo}).select("id").single();throwFirst(result);
      await audit(supabase,member,"job_posting_created","job_posting",result.data!.id);return Response.json({ok:true,id:result.data!.id});
    } else if(input.action==="update_job_posting"){
      requireOrganizationManager(member);
      const result=await supabase.from("job_postings").update({title:input.title,company:input.company,body:input.body,hourly_rate:input.hourlyRate,location:input.location,deadline:input.deadline,contact_info:input.contactInfo,is_active:input.isActive,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"job_posting_updated","job_posting",input.id);
    } else if(input.action==="delete_job_posting"){
      requireOrganizationManager(member);
      const result=await supabase.from("job_postings").delete().eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"job_posting_deleted","job_posting",input.id);
    } else if(input.action==="create_business_contest"){
      requireOrganizationManager(member);
      const result=await supabase.from("business_contests").insert({club_id:member.club_id,author_member_id:member.id,title:input.title,organizer:input.organizer,body:input.body,url:input.url,event_date:input.eventDate,deadline:input.deadline,location:input.location}).select("id").single();throwFirst(result);
      await audit(supabase,member,"business_contest_created","business_contest",result.data!.id);return Response.json({ok:true,id:result.data!.id});
    } else if(input.action==="update_business_contest"){
      requireOrganizationManager(member);
      const result=await supabase.from("business_contests").update({title:input.title,organizer:input.organizer,body:input.body,url:input.url,event_date:input.eventDate,deadline:input.deadline,location:input.location,is_active:input.isActive,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"business_contest_updated","business_contest",input.id);
    } else if(input.action==="delete_business_contest"){
      requireOrganizationManager(member);
      const result=await supabase.from("business_contests").delete().eq("club_id",member.club_id).eq("id",input.id);throwFirst(result);
      await audit(supabase,member,"business_contest_deleted","business_contest",input.id);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

function throwFirst(...results: Array<{ error: unknown }>) {
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

async function audit(supabase:Awaited<ReturnType<typeof requireMember>>["supabase"],member:{id:string;club_id:string},action:string,entityType:string,entityId:string|null,metadata:Record<string,unknown>={}){const result=await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action,entity_type:entityType,entity_id:entityId,metadata});throwFirst(result)}

type Db=Awaited<ReturnType<typeof requireMember>>["supabase"];
type Actor=Awaited<ReturnType<typeof requireMember>>["member"];

/** Officer acting on another member, respecting the hierarchy (幹部は部員のみ、代表は全員、自分と代表は対象外). */
async function loadTarget(supabase:Db,member:Actor,memberId:string){
  requireOrganizationManager(member);
  const target=await supabase.from("members").select("id,access_role,status").eq("club_id",member.club_id).eq("id",memberId).maybeSingle();throwFirst(target);
  if(!target.data)return Response.json({error:"not_found",message:"部員が見つかりません。"},{status:404});
  if(!canActOnMember(member,target.data))return Response.json({error:"owner_required",message:"この部員の状態は代表だけが変更できます。"},{status:403});
  return target.data;
}

/** 第11条: 退部時は団体アカウントの権限を解除する（Google連携・端末・名刺閲覧権限・保留中の申請）。 */
async function withdrawMember(supabase:Db,member:Actor,memberId:string,reason:string){
  const now=new Date().toISOString();
  const results=await Promise.all([
    supabase.from("members").update({status:"withdrawn",status_reason:reason,left_at:now,library_access:false,library_access_granted_by:null,library_access_granted_at:null,selected_event_id:null,updated_at:now}).eq("club_id",member.club_id).eq("id",memberId),
    supabase.from("user_google_connections").delete().eq("club_id",member.club_id).eq("member_id",memberId),
    supabase.from("devices").update({revoked_at:now}).eq("club_id",member.club_id).eq("member_id",memberId).is("revoked_at",null),
    supabase.from("library_access_requests").update({status:"cancelled",decided_at:now}).eq("club_id",member.club_id).eq("member_id",memberId).eq("status","pending"),
  ]);
  throwFirst(...results);
  await audit(supabase,member,"member_withdrawn","member",memberId,{reason});
}
