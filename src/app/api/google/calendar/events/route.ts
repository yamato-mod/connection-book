import {z} from "zod";
import {apiError} from "@/lib/api-error";
import {decryptGoogleToken} from "@/lib/google-token-crypto";
import {createOrganizationCalendarEvent,listOrganizationCalendarEvents} from "@/lib/google";
import {assertSameOrigin,requireMember,requireOrganizationManager} from "@/lib/server-auth";

const googleEventSchema=z.object({
  googleEventId:z.string().min(1).max(1024),
  name:z.string().trim().min(1).max(200),
  startsAt:z.string().min(1),
  endsAt:z.string().nullable(),
  location:z.string().max(300),
  description:z.string().max(5000),
  htmlLink:z.string().url().nullable(),
  allDay:z.boolean(),
});
const postSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),name:z.string().trim().min(1).max(200),startsAt:z.string().datetime(),endsAt:z.string().datetime(),location:z.string().max(300),description:z.string().max(5000),makeCurrent:z.boolean()}),
  z.object({action:z.literal("select"),localEventId:z.string().uuid().optional(),googleEvent:googleEventSchema.optional()}).refine(value=>Boolean(value.localEventId)!==Boolean(value.googleEvent),"Select exactly one event"),
]);
const eventSelect="id,name,description,starts_at,ends_at,location,is_current,google_calendar_event_id,google_html_link,calendar_source,calendar_sync_status,calendar_error,all_day,event_contacts(contact:contacts(classification))";

export async function GET(request:Request){
  try{
    const {member,supabase}=await requireMember(request),url=new URL(request.url),now=new Date();
    const timeMin=parseTime(url.searchParams.get("from"),new Date(now.getTime()-30*86400000));
    const timeMax=parseTime(url.searchParams.get("to"),new Date(now.getTime()+365*86400000));
    const [localResult,connectionResult]=await Promise.all([
      supabase.from("events").select(eventSelect).eq("club_id",member.club_id).gte("starts_at",timeMin).lte("starts_at",timeMax).order("starts_at"),
      supabase.from("organization_google_connections").select("google_email,encrypted_refresh_token,status,scopes").eq("club_id",member.club_id).maybeSingle(),
    ]);
    if(localResult.error)throw localResult.error;if(connectionResult.error)throw connectionResult.error;
    const connection=connectionResult.data,scope="https://www.googleapis.com/auth/calendar.events.owned";
    const base={localEvents:localResult.data??[],selectedEventId:member.selected_event_id,canManage:member.access_role==="owner"||member.access_role==="admin",calendarConnected:Boolean(connection?.status==="active"),calendarEmail:connection?.google_email??null,reconnectRequired:Boolean(connection&&!(connection.scopes??[]).includes(scope))};
    if(!connection||connection.status!=="active"||!(connection.scopes??[]).includes(scope))return Response.json({...base,googleEvents:[]},{headers:{"Cache-Control":"no-store"}});
    try{
      const result=await listOrganizationCalendarEvents({refreshToken:decryptGoogleToken(connection.encrypted_refresh_token),timeMin,timeMax});
      const googleEvents=(result.data.items??[]).filter(item=>item.id&&item.status!=="cancelled").map(item=>({googleEventId:item.id!,name:item.summary??"（タイトルなし）",description:item.description??"",startsAt:item.start?.dateTime??item.start?.date??"",endsAt:item.end?.dateTime??item.end?.date??null,location:item.location??"",htmlLink:item.htmlLink??null,allDay:Boolean(item.start?.date),updatedAt:item.updated??null}));
      return Response.json({...base,googleEvents},{headers:{"Cache-Control":"no-store"}});
    }catch(error){return Response.json({...base,googleEvents:[],calendarError:error instanceof Error?error.message:"Googleカレンダーを取得できませんでした。"},{headers:{"Cache-Control":"no-store"}})}
  }catch(error){return apiError(error)}
}

export async function POST(request:Request){
  try{
    assertSameOrigin(request);const {member,supabase}=await requireMember(request),parsed=postSchema.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:"invalid_input",message:"イベント情報を確認してください。"},{status:400});
    const input=parsed.data;
    if(input.action==="select"){
      let eventId=input.localEventId;
      if(input.googleEvent){
        const event=input.googleEvent,start=calendarDate(event.startsAt),end=event.endsAt?calendarDate(event.endsAt):null;
        const existing=await supabase.from("events").select("id").eq("club_id",member.club_id).eq("google_calendar_event_id",event.googleEventId).maybeSingle();if(existing.error)throw existing.error;
        if(existing.data)eventId=existing.data.id;else{const inserted=await supabase.from("events").insert({club_id:member.club_id,name:event.name,description:event.description,starts_at:start,ends_at:end,location:event.location,is_current:false,created_by:member.id,google_calendar_event_id:event.googleEventId,google_html_link:event.htmlLink,calendar_source:"google",calendar_sync_status:"synced",all_day:event.allDay}).select("id").single();if(inserted.error)throw inserted.error;eventId=inserted.data.id}
      }
      const selected=await supabase.from("members").update({selected_event_id:eventId,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",member.id);if(selected.error)throw selected.error;
      await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"current_event_selected",entity_type:"event",entity_id:eventId});
      return Response.json({ok:true,id:eventId});
    }

    requireOrganizationManager(member);if(new Date(input.endsAt)<=new Date(input.startsAt))return Response.json({error:"invalid_event_range",message:"終了日時は開始日時より後にしてください。"},{status:400});
    const connection=await supabase.from("organization_google_connections").select("google_email,encrypted_refresh_token,status,scopes").eq("club_id",member.club_id).maybeSingle();if(connection.error)throw connection.error;
    const scope="https://www.googleapis.com/auth/calendar.events.owned";
    if(!connection.data||connection.data.status!=="active")return Response.json({error:"organization_google_not_connected",message:"設定画面で組織Googleアカウントを接続してください。"},{status:409});
    if(!(connection.data.scopes??[]).includes(scope))return Response.json({error:"calendar_scope_required",message:"カレンダー権限を追加するため、組織Googleアカウントを再接続してください。"},{status:409});
    const inserted=await supabase.from("events").insert({club_id:member.club_id,name:input.name,description:input.description,starts_at:input.startsAt,ends_at:input.endsAt,location:input.location,is_current:false,created_by:member.id,calendar_source:"app",calendar_sync_status:"pending"}).select("id").single();if(inserted.error)throw inserted.error;
    try{
      const created=await createOrganizationCalendarEvent({refreshToken:decryptGoogleToken(connection.data.encrypted_refresh_token),summary:input.name,description:`${input.description}${input.description?"\n\n":""}つながり帳から登録`,location:input.location,start:input.startsAt,end:input.endsAt});
      const updated=await supabase.from("events").update({google_calendar_event_id:created.data.id,google_html_link:created.data.htmlLink,google_updated_at:created.data.updated,calendar_sync_status:"synced",calendar_error:null}).eq("club_id",member.club_id).eq("id",inserted.data.id);if(updated.error)throw updated.error;
      if(input.makeCurrent){const cleared=await supabase.from("events").update({is_current:false}).eq("club_id",member.club_id).eq("is_current",true);if(cleared.error)throw cleared.error;const current=await supabase.from("events").update({is_current:true}).eq("club_id",member.club_id).eq("id",inserted.data.id);if(current.error)throw current.error;await supabase.from("members").update({selected_event_id:inserted.data.id,updated_at:new Date().toISOString()}).eq("club_id",member.club_id).eq("id",member.id)}
      await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"organization_calendar_event_created",entity_type:"event",entity_id:inserted.data.id,metadata:{google_calendar_event_id:created.data.id,calendar_email:connection.data.google_email}});
      return Response.json({ok:true,id:inserted.data.id,googleEventId:created.data.id});
    }catch(error){await supabase.from("events").update({calendar_sync_status:"failed",calendar_error:(error instanceof Error?error.message:"Calendar sync failed").slice(0,1000)}).eq("club_id",member.club_id).eq("id",inserted.data.id);throw error}
  }catch(error){return apiError(error)}
}

function parseTime(value:string|null,fallback:Date){if(!value)return fallback.toISOString();const parsed=new Date(value);return Number.isNaN(parsed.getTime())?fallback.toISOString():parsed.toISOString()}
function calendarDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T00:00:00+09:00`:new Date(value).toISOString()}
