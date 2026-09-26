import {z} from "zod";
import {apiError} from "@/lib/api-error";
import {assertSameOrigin,requireUser} from "@/lib/server-auth";

const inputSchema=z.object({
  organizationName:z.string().trim().min(2).max(120),
  organizationType:z.enum(["university_club","student_organization","other"]),
  ownerName:z.string().trim().min(1).max(120),
  ownerTitle:z.string().trim().max(120),
});

export async function POST(request:Request){
  try{
    assertSameOrigin(request);
    const {supabase,user}=await requireUser(request);
    if(!user.email_confirmed_at)return Response.json({error:"email_not_confirmed",message:"メール認証を完了してください。"},{status:403});
    const parsed=inputSchema.safeParse(await request.json());
    if(!parsed.success)return Response.json({error:"invalid_input",message:"入力内容を確認してください。"},{status:400});

    const existing=await supabase.from("members").select("id,club_id").eq("auth_user_id",user.id).maybeSingle();
    if(existing.error)throw existing.error;
    if(existing.data)return Response.json({error:"already_member",message:"このアカウントはすでに団体へ所属しています。"},{status:409});

    const created=await supabase.rpc("create_organization_for_user",{
      p_auth_user_id:user.id,
      p_organization_name:parsed.data.organizationName,
      p_organization_type:parsed.data.organizationType,
      p_owner_name:parsed.data.ownerName,
      p_owner_title:parsed.data.ownerTitle,
    });
    if(created.error)throw created.error;
    const row=created.data?.[0];
    if(!row)throw new Error("Organization onboarding returned no result");
    return Response.json({ok:true,clubId:row.club_id,memberId:row.member_id},{status:201,headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error)}
}
