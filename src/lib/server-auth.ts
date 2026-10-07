import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccessRole } from "@/lib/organization-mail";
import { membershipGate } from "@/lib/membership";

export type RequireMemberOptions={
  /** オーナーの二段階認証が済んでいなくても通す（認証画面そのものと、認証画面を出すためのホーム表示だけ）。 */
  allowPendingOwner2FA?:boolean;
};

export async function requireMember(request: Request,options:RequireMemberOptions={}){
  const {supabase,user,authSessionId}=await requireUser(request);
  const {data:member}=await supabase.from("members").select("id, club_id, name, role, signature, is_admin, access_role, position, status, suspended_until, library_access, selected_event_id").eq("auth_user_id",user.id).maybeSingle();
  if(!member) throw jsonAuthError("member_required","このアカウントはまだ団体に所属していません。団体を作成するか、招待コードから入部を申請してください。",403);
  const gate=membershipGate(member);
  if(!gate.ok) throw jsonAuthError(gate.error,gate.message,403);
  // 期限付きの活動停止が明けたら自動で在籍に戻す（第35条: 30日以内の一時制限）。
  if(member.status==="suspended"){await supabase.from("members").update({status:"active",status_reason:"",updated_at:new Date().toISOString()}).eq("id",member.id);member.status="active";}
  // オーナーは個人メールを登録していれば、このログインで認証コードを確認するまで何も操作できない。
  if(!options.allowPendingOwner2FA&&await ownerNeeds2FA(supabase,member,authSessionId)) throw jsonAuthError("owner_2fa_required","オーナー認証が必要です。ホーム画面で、個人メールに届く認証コードを入力してください。",403);
  return {supabase,user,member,authSessionId};
}

export async function requireUser(request: Request){
  const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
  if(!token) throw jsonAuthError("authentication_required","ログインが必要です。",401);
  const supabase=createAdminClient(); const {data:{user},error}=await supabase.auth.getUser(token);
  if(error||!user) throw jsonAuthError("invalid_session","ログインの有効期限が切れました。",401);
  return {supabase,user,authSessionId:sessionIdFromToken(token)};
}

/** Supabaseのアクセストークン（getUserで検証済み）から、ログインごとに変わる session_id を取り出す。 */
function sessionIdFromToken(token:string):string|null{
  try{
    const payload=JSON.parse(Buffer.from(token.split(".")[1]??"","base64url").toString("utf8")) as {session_id?:unknown};
    return typeof payload.session_id==="string"&&payload.session_id?payload.session_id:null;
  }catch{return null}
}

/** 認証コードの確認が有効な時間。同じログインでも、この時間を過ぎたらもう一度コードを確認する。 */
export const OWNER_2FA_VALID_MS=24*60*60*1000;

/**
 * このオーナーが、今のログインで二段階認証を済ませる必要があるか。
 * 個人メールを登録していないオーナー、オーナー以外は対象外。
 * 確認済みかどうかはログイン（session_id）ごとに見るので、別の端末で認証しても、こちらの端末は通らない。
 */
export async function ownerNeeds2FA(supabase:ReturnType<typeof createAdminClient>,member:{id:string;club_id:string;access_role:string},authSessionId:string|null){
  if(member.access_role!=="owner") return false;
  const {data:registered,error}=await supabase.from("owner_2fa_emails").select("id").eq("club_id",member.club_id).eq("member_id",member.id).maybeSingle();
  if(error) throw error;
  if(!registered) return false;
  if(!authSessionId) return true;
  const {data:verified,error:verifiedError}=await supabase.from("owner_2fa_verifications").select("id")
    .eq("member_id",member.id).eq("purpose","login").eq("auth_session_id",authSessionId)
    .not("verified_at","is",null).gte("verified_at",new Date(Date.now()-OWNER_2FA_VALID_MS).toISOString())
    .limit(1).maybeSingle();
  if(verifiedError) throw verifiedError;
  return !verified;
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
