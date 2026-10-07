import {apiError} from "@/lib/api-error";
import {requireUser} from "@/lib/server-auth";
import {membershipGate} from "@/lib/membership";

export async function GET(request:Request){
  try{
    const {supabase,user}=await requireUser(request);
    const {data:member,error}=await supabase
      .from("members")
      .select("id,club_id,name,access_role,is_active,status,suspended_until,club:clubs(name)")
      .eq("auth_user_id",user.id)
      .maybeSingle();
    if(error)throw error;
    const gate=member?membershipGate(member):null;
    return Response.json({
      authenticated:true,
      email:user.email??"",
      hasMembership:Boolean(gate?.ok),
      // 承認待ち・活動停止中・退部をはじめる画面で説明できるように返す。
      membershipStatus:member?.status??null,
      membershipMessage:gate&&!gate.ok?gate.message:null,
      member:gate?.ok?member:null,
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error)}
}
