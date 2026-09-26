import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccessRole } from "@/lib/organization-mail";

export async function requireMember(request: Request){
  const {supabase,user}=await requireUser(request);
  const {data:member}=await supabase.from("members").select("id, club_id, name, role, signature, is_admin, access_role, selected_event_id").eq("auth_user_id",user.id).eq("is_active",true).single();
  if(!member) throw jsonAuthError("member_required","このアカウントはまだ団体に所属していません。団体を作成するか、幹部からの招待を確認してください。",403);
  return {supabase,user,member};
}

export async function requireUser(request: Request){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) throw jsonAuthError("authentication_required","ログインが必要です。",401);
  const supabase=createAdminClient(); const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user) throw jsonAuthError("invalid_session","ログインの有効期限が切れました。",401);
  return {supabase,user};
}

function jsonAuthError(error:string,message:string,status:number){
  return Response.json({error,message},{status,headers:{"Cache-Control":"no-store"}});
}

export function requireOrganizationManager(member:{access_role:string}){
  if(member.access_role!=="owner"&&member.access_role!=="admin")throw new Response("Organization manager access required",{status:403});
}

export function requireOwner(member:{access_role:string}){
  if(member.access_role!=="owner")throw new Response("Owner access required",{status:403});
}

export function asAccessRole(value:string):AccessRole{
  if(value==="owner"||value==="admin"||value==="member")return value;
  throw new Response("Invalid member role",{status:403});
}

export function assertSameOrigin(request: Request){
  const origin=request.headers.get("origin"); if(!origin) throw new Response("Origin required",{status:403});
  const expected=process.env.NEXT_PUBLIC_APP_URL; const requestOrigin=new URL(request.url).origin;
  if(origin!==requestOrigin && (!expected||origin!==new URL(expected).origin)) throw new Response("Invalid origin",{status:403});
}
