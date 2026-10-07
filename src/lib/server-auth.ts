import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccessRole } from "@/lib/organization-mail";
import { membershipGate } from "@/lib/membership";

export async function requireMember(request: Request){
  const {supabase,user}=await requireUser(request);
  const {data:member}=await supabase.from("members").select("id, club_id, name, role, signature, is_admin, access_role, position, status, suspended_until, library_access, selected_event_id").eq("auth_user_id",user.id).maybeSingle();
  if(!member) throw jsonAuthError("member_required","このアカウントはまだ団体に所属していません。団体を作成するか、招待コードから入部を申請してください。",403);
  const gate=membershipGate(member);
  if(!gate.ok) throw jsonAuthError(gate.error,gate.message,403);
  // 期限付きの活動停止が明けたら自動で在籍に戻す（第35条: 30日以内の一時制限）。
  if(member.status==="suspended"){await supabase.from("members").update({status:"active",status_reason:"",updated_at:new Date().toISOString()}).eq("id",member.id);member.status="active";}
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

/**
 * Check if the owner has completed 2FA verification for this session.
 * Called after requireOwner() when owner-level operations need 2FA enforcement.
 * Returns true if 2FA is not required (no personal email registered) or if verified.
 */
export async function requireOwner2FA(supabase: ReturnType<typeof createAdminClient>, member: {id:string; club_id:string; access_role:string}){
  requireOwner(member);
  // Check if owner has a registered 2FA email
  const {data:twoFaEmail} = await supabase.from("owner_2fa_emails").select("id").eq("club_id", member.club_id).maybeSingle();
  if(!twoFaEmail) return; // No 2FA email registered — skip 2FA check

  // Check for a verified 2FA session within the last 24 hours
  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const {data:verified} = await supabase.from("owner_2fa_verifications")
    .select("id")
    .eq("member_id", member.id)
    .not("verified_at", "is", null)
    .gte("verified_at", windowStart)
    .limit(1)
    .maybeSingle();

  if(!verified) throw Response.json({error:"owner_2fa_required",message:"オーナー認証が必要です。個人メールに送信された認証コードを入力してください。"},{status:403,headers:{"Cache-Control":"no-store"}});
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
