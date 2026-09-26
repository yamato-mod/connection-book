import { mailSchema } from "@/lib/domain";
import { verifyConfirmationToken } from "@/lib/confirmation-token";
import { sendGmail } from "@/lib/google";
import { decryptGoogleToken } from "@/lib/google-token-crypto";
import { asAccessRole, assertSameOrigin, requireMember } from "@/lib/server-auth";
import { enforcedCc, senderModeForRole, type MailSettings } from "@/lib/organization-mail";

export async function POST(request:Request){
  let logContext:{id:string;supabase:Awaited<ReturnType<typeof requireMember>>["supabase"]}|null=null;
  let requestContext:{key:string;supabase:Awaited<ReturnType<typeof requireMember>>["supabase"]}|null=null;
  try{
    assertSameOrigin(request);const {user,member,supabase}=await requireMember(request);const parsed=mailSchema.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:"invalid_input",details:parsed.error.flatten()},{status:400});const input=parsed.data;
    const {data:contact}=await supabase.from("contacts").select("id,email,classification").eq("id",input.contactId).eq("club_id",member.club_id).single();
    if(!contact||contact.classification!=="courtesy"||contact.email?.toLowerCase()!==input.recipientEmail)return Response.json({error:"contact_state_changed"},{status:409});
    if(!verifyConfirmationToken(input.confirmationToken,{userId:user.id,contactId:input.contactId,email:input.recipientEmail}))return Response.json({error:"recipient_confirmation_expired"},{status:409});

    const [settingsResult,organizationConnection,userConnection]=await Promise.all([
      supabase.from("organization_mail_settings").select("admin_sender_mode,member_sender_mode,auto_cc_organization_email,allow_member_to_disable_cc").eq("club_id",member.club_id).single(),
      supabase.from("organization_google_connections").select("google_email,encrypted_refresh_token,status").eq("club_id",member.club_id).maybeSingle(),
      supabase.from("user_google_connections").select("google_email,encrypted_refresh_token,status").eq("club_id",member.club_id).eq("member_id",member.id).maybeSingle(),
    ]);
    if(settingsResult.error)throw settingsResult.error;
    const settings=settingsResult.data as MailSettings,role=asAccessRole(member.access_role),senderMode=senderModeForRole(role,settings);
    const selected=senderMode==="organization_email"?organizationConnection.data:userConnection.data;
    if(!selected||selected.status!=="active")return Response.json({error:senderMode==="organization_email"?"organization_google_not_connected":"user_google_not_connected"},{status:409});
    const cc=enforcedCc({role,settings,organizationEmail:organizationConnection.data?.google_email??null,requestedCc:input.cc,disableOrganizationCc:input.disableOrganizationCc});

    const {error:claimError}=await supabase.from("email_send_requests").insert({club_id:member.club_id,contact_id:input.contactId,requested_by:member.id,idempotency_key:input.idempotencyKey,status:"processing"});
    if(claimError){const existing=await supabase.from("email_send_requests").select("status").eq("idempotency_key",input.idempotencyKey).eq("club_id",member.club_id).maybeSingle();if(existing.data?.status==="sent")return Response.json({ok:true,reused:true},{headers:{"Cache-Control":"no-store"}});return Response.json({error:"duplicate_submission",message:"同じ送信操作は既に処理中または失敗済みです。送信履歴を確認してください。"},{status:409});}
    requestContext={key:input.idempotencyKey,supabase};

    let templateSubject:string|null=null,templateBody:string|null=null;
    if(input.templateId){const template=await supabase.from("email_templates").select("default_subject,default_body").eq("id",input.templateId).eq("club_id",member.club_id).maybeSingle();templateSubject=template.data?.default_subject??null;templateBody=template.data?.default_body??null}
    const pending=await supabase.from("email_logs").insert({club_id:member.club_id,contact_id:input.contactId,recipient_email:input.recipientEmail,sender_member_id:member.id,actual_from_email:selected.google_email,sender_mode:senderMode,cc_emails:cc,bcc_emails:input.bcc,template_id:input.templateId,event_id:input.eventId,template_subject:templateSubject,template_body:templateBody,final_subject:input.subject,final_body:input.body,status:"pending",duplicate_override:input.duplicateOverride,duplicate_override_reason:input.duplicateOverrideReason}).select("id").single();
    if(pending.error)throw pending.error;logContext={id:pending.data.id,supabase};

    const sent=await sendGmail({from:selected.google_email,to:input.recipientEmail,cc,bcc:input.bcc,subject:input.subject,body:input.body,refreshToken:decryptGoogleToken(selected.encrypted_refresh_token)});const sentAt=new Date().toISOString();
    const recorded=await supabase.from("email_logs").update({status:"sent",sent_at:sentAt,gmail_message_id:sent.data.id??null,gmail_thread_id:sent.data.threadId??null,error_message:null}).eq("id",pending.data.id).eq("club_id",member.club_id);if(recorded.error)throw recorded.error;
    await supabase.from("email_send_requests").update({status:"sent",completed_at:sentAt}).eq("idempotency_key",input.idempotencyKey);
    await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"email_sent",entity_type:"email_log",entity_id:pending.data.id,metadata:{actual_from_email:selected.google_email,sender_mode:senderMode,recipient_email:input.recipientEmail,cc,duplicate_override:input.duplicateOverride}});
    return Response.json({ok:true,messageId:sent.data.id,threadId:sent.data.threadId,from:selected.google_email,cc},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    const message=(error instanceof Error?error.message:"send failed").slice(0,1000),completedAt=new Date().toISOString();
    if(logContext)await logContext.supabase.from("email_logs").update({status:"failed",error_message:message}).eq("id",logContext.id);
    if(requestContext)await requestContext.supabase.from("email_send_requests").update({status:"failed",completed_at:completedAt}).eq("idempotency_key",requestContext.key);
    if(error instanceof Response)return error;console.error("gmail send failed",error);return Response.json({error:"send_failed"},{status:502});
  }
}
