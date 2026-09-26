import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, asAccessRole, requireMember, requireOrganizationManager } from "@/lib/server-auth";
import { googleAuthorizationUrl } from "@/lib/google";
import { issueGoogleOAuthState } from "@/lib/google-oauth-state";

const schema=z.object({type:z.enum(["organization","user"])});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const {member}=await requireMember(request);
    const parsed=schema.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:"invalid_input"},{status:400});
    if(parsed.data.type==="organization")requireOrganizationManager(member);
    const nonce=randomUUID();
    const state=issueGoogleOAuthState({type:parsed.data.type,clubId:member.club_id,memberId:member.id,role:asAccessRole(member.access_role),nonce,expiresAt:Date.now()+10*60_000});
    const response=NextResponse.json({url:googleAuthorizationUrl(state,parsed.data.type)},{headers:{"Cache-Control":"no-store"}});
    response.cookies.set("google-oauth-nonce",nonce,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:600,path:"/api/google/oauth"});
    return response;
  }catch(error){if(error instanceof Response)return error;return Response.json({error:"google_oauth_not_configured"},{status:503})}
}
