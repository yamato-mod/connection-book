import { z } from "zod";
import { assertSameOrigin, requireMember, requireOrganizationManager } from "@/lib/server-auth";
const schema=z.object({type:z.enum(["organization","user"])});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);const {member,supabase}=await requireMember(request);const parsed=schema.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:"invalid_input"},{status:400});
    if(parsed.data.type==="organization"){
      requireOrganizationManager(member);
      const removed=await supabase.from("organization_google_connections").delete().eq("club_id",member.club_id);if(removed.error)throw removed.error;
      await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"organization_google_disconnected",entity_type:"organization_google_connection"});
    }else{
      const removed=await supabase.from("user_google_connections").delete().eq("club_id",member.club_id).eq("member_id",member.id);if(removed.error)throw removed.error;
      await supabase.from("audit_logs").insert({club_id:member.club_id,actor_member_id:member.id,action:"user_google_disconnected",entity_type:"user_google_connection"});
    }
    return Response.json({ok:true},{headers:{"Cache-Control":"no-store"}});
  }catch(error){if(error instanceof Response)return error;return Response.json({error:"disconnect_failed"},{status:500})}
}
