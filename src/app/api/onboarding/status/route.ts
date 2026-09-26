import {apiError} from "@/lib/api-error";
import {requireUser} from "@/lib/server-auth";

export async function GET(request:Request){
  try{
    const {supabase,user}=await requireUser(request);
    const {data:member,error}=await supabase
      .from("members")
      .select("id,club_id,name,access_role,is_active,club:clubs(name)")
      .eq("auth_user_id",user.id)
      .eq("is_active",true)
      .maybeSingle();
    if(error)throw error;
    return Response.json({
      authenticated:true,
      email:user.email??"",
      hasMembership:Boolean(member),
      member:member??null,
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error)}
}
