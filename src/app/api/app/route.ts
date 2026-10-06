import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { asAccessRole, assertSameOrigin, requireMember, requireOrganizationManager, requireOwner } from "@/lib/server-auth";
import { canEditContact, resolveSender, type MailSettings } from "@/lib/organization-mail";
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
  z.object({action:z.literal("update_mail_settings"),adminSenderMode:z.enum(["organization_email","personal_email"]),memberSenderMode:z.enum(["personal_email","organization_email"]),autoCcOrganizationEmail:z.boolean(),allowMemberToDisableCc:z.boolean()}),
  z.object({action:z.literal("invite_member"),email:z.string().trim().toLowerCase().email(),name:z.string().trim().min(1).max(120),title:z.string().trim().max(120),accessRole:z.enum(["admin","member"])}),
  z.object({action:z.literal("change_member_role"),memberId:z.string().uuid(),accessRole:z.enum(["admin","member"])}),
  z.object({action:z.literal("deactivate_member"),memberId:z.string().uuid()}),
  z.object({action:z.literal("transfer_owner"),memberId:z.string().uuid()}),
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
      const result = await supabase.from("contacts").select("id,name,company_name,university_name,organization_name,role,email,phone,classification,last_contact_at,owner:members!contacts_owner_member_id_fkey(name),contact_tags(tags(name,color)),event_contacts(event:events(name,starts_at))").eq("club_id", member.club_id).order("last_contact_at", { ascending: false }).limit(500);
      throwFirst(result);const contacts=search?(result.data??[]).filter(row=>JSON.stringify(row).toLocaleLowerCase("ja-JP").includes(search)):(result.data??[]);return Response.json({ contacts:contacts.slice(0,100), canManage:member.access_role!=="member" });
    }
    if (view === "contact") {
      const id = z.string().uuid().parse(url.searchParams.get("id"));
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
        manager?supabase.from("members").select("id,name,role,access_role,is_active,created_at").eq("club_id",member.club_id).order("created_at"):Promise.resolve({data:[],error:null}),
        // Every member needs the organization sender status (members may send from it or be auto-CC'd). Never select the token here.
        supabase.from("organization_google_connections").select("google_email,status,connected_at").eq("club_id",member.club_id).maybeSingle(),
        supabase.from("user_google_connections").select("google_email,status,connected_at").eq("club_id",member.club_id).eq("member_id",member.id).maybeSingle(),
      ]);
      throwFirst(devices, templates, jobs,club,mailSettings,members,organizationGoogle,userGoogle);
      const legacyGoogleConfigured = [process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REFRESH_TOKEN,process.env.GOOGLE_SHARED_GMAIL].every(isConfiguredValue);
      const oauthClientConfigured=[process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET,process.env.GOOGLE_REDIRECT_URI,process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,process.env.GOOGLE_OAUTH_STATE_SECRET].every(isConfiguredValue);
      const sender=resolveSender({role:asAccessRole(member.access_role),settings:mailSettings.data as MailSettings,organizationGoogle:organizationGoogle.data,userGoogle:userGoogle.data});
      return Response.json({ member,sender,organization:club.data,mailSettings:mailSettings.data,members:members.data??[],organizationGoogle:organizationGoogle.data,userGoogle:userGoogle.data,oauthClientConfigured,devices: devices.data ?? [], templates: templates.data ?? [], jobs: jobs.data ?? [], integrations: { gmail: Boolean(organizationGoogle.data||userGoogle.data), drive: legacyGoogleConfigured, people: legacyGoogleConfigured, calendar: legacyGoogleConfigured } });
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
      const created=await supabase.from("members").insert({club_id:member.club_id,auth_user_id:invited.id,name:input.name,role:input.title,signature_display_name:input.name,signature:`${input.name}\n${input.title}`.trim(),access_role:input.accessRole,is_admin:input.accessRole==="admin",is_active:true}).select("id").single();throwFirst(created);await audit(supabase,member,"member_added","member",created.data!.id,{access_role:input.accessRole});
    } else if(input.action==="change_member_role"){
      requireOwner(member);if(input.memberId===member.id)return Response.json({error:"use_owner_transfer"},{status:409});const changed=await supabase.from("members").update({access_role:input.accessRole,is_admin:input.accessRole==="admin",updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId).neq("access_role","owner");throwFirst(changed);await audit(supabase,member,"member_role_changed","member",input.memberId,{access_role:input.accessRole});
    } else if(input.action==="deactivate_member"){
      requireOrganizationManager(member);if(input.memberId===member.id)return Response.json({error:"cannot_remove_self"},{status:409});const target=await supabase.from("members").select("access_role").eq("club_id",member.club_id).eq("id",input.memberId).single();throwFirst(target);if(target.data?.access_role==="owner"||(member.access_role==="admin"&&target.data?.access_role!=="member"))return Response.json({error:"owner_required"},{status:403});const removed=await supabase.from("members").update({is_active:false,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",input.memberId);throwFirst(removed);await audit(supabase,member,"member_removed","member",input.memberId);
    } else if(input.action==="transfer_owner"){
      requireOwner(member);const transferred=await supabase.rpc("transfer_organization_owner",{p_club_id:member.club_id,p_current_owner_id:member.id,p_new_owner_id:input.memberId});throwFirst(transferred);await audit(supabase,member,"owner_transferred","member",input.memberId,{previous_owner_id:member.id});
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

function throwFirst(...results: Array<{ error: unknown }>) {
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
}

async function audit(supabase:Awaited<ReturnType<typeof requireMember>>["supabase"],member:{id:string;club_id:string},action:string,entityType:string,entityId:string|null,metadata:Record<string,unknown>={}){const result=await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action,entity_type:entityType,entity_id:entityId,metadata});throwFirst(result)}
