import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeGoogleAuthorizationCode, GMAIL_SEND_SCOPE } from "@/lib/google";
import { verifyGoogleOAuthState } from "@/lib/google-oauth-state";
import { encryptGoogleToken } from "@/lib/google-token-crypto";

export async function GET(request:Request){
  const appUrl=process.env.NEXT_PUBLIC_APP_URL??new URL(request.url).origin;
  const redirect=(status:string)=>NextResponse.redirect(new URL(`/settings?google=${status}`,appUrl));
  try{
    const url=new URL(request.url),code=url.searchParams.get("code"),stateValue=url.searchParams.get("state");
    if(!code||!stateValue)return redirect("invalid");
    const state=verifyGoogleOAuthState(stateValue),nonce=(await cookies()).get("google-oauth-nonce")?.value;
    if(!state||!nonce||state.nonce!==nonce)return redirect("invalid");
    const supabase=createAdminClient();
    const {data:member}=await supabase.from("members").select("id,club_id,access_role,is_active").eq("id",state.memberId).eq("club_id",state.clubId).single();
    if(!member?.is_active)return redirect("forbidden");
    if(state.type==="organization"&&member.access_role!=="owner"&&member.access_role!=="admin")return redirect("forbidden");
    const connection=await exchangeGoogleAuthorizationCode(code);
    // Google's consent screen lets users untick individual permissions. Without Gmail permission the account looks "connected" but can never send.
    if(!connection.scopes.includes(GMAIL_SEND_SCOPE))return redirect("missing_scope");
    const encrypted=encryptGoogleToken(connection.refreshToken),now=new Date().toISOString();
    if(state.type==="organization"){
      const result=await supabase.from("organization_google_connections").upsert({club_id:state.clubId,google_email:connection.email,encrypted_refresh_token:encrypted,token_expires_at:connection.expiresAt,scopes:connection.scopes,connected_by_member_id:member.id,connected_at:now,status:"active",updated_at:now},{onConflict:"club_id"});
      if(result.error)throw result.error;
      await supabase.from("audit_logs").insert({club_id:state.clubId,actor_member_id:member.id,action:"organization_google_connected",entity_type:"organization_google_connection",metadata:{google_email:connection.email}});
    }else{
      const result=await supabase.from("user_google_connections").upsert({club_id:state.clubId,member_id:member.id,google_email:connection.email,encrypted_refresh_token:encrypted,token_expires_at:connection.expiresAt,scopes:connection.scopes,connected_at:now,status:"active",updated_at:now},{onConflict:"member_id"});
      if(result.error)throw result.error;
      await supabase.from("audit_logs").insert({club_id:state.clubId,actor_member_id:member.id,action:"user_google_connected",entity_type:"user_google_connection",metadata:{google_email:connection.email}});
    }
    const response=redirect("connected");response.cookies.delete("google-oauth-nonce");return response;
  }catch(error){console.error("Google OAuth callback failed",error);return redirect("failed")}
}
