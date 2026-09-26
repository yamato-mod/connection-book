import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({send:vi.fn(),requireMember:vi.fn(),verify:vi.fn(),decrypt:vi.fn(()=>"refresh")}));
vi.mock("@/lib/server-auth",async()=>{const actual=await vi.importActual<typeof import("@/lib/server-auth")>("@/lib/server-auth");return{...actual,assertSameOrigin:vi.fn(),requireMember:mocks.requireMember}});
vi.mock("@/lib/google",()=>({sendGmail:mocks.send}));
vi.mock("@/lib/google-token-crypto",()=>({decryptGoogleToken:mocks.decrypt}));
vi.mock("@/lib/confirmation-token",()=>({verifyConfirmationToken:mocks.verify}));
import {POST} from "../src/app/api/gmail/send/route";

const input={contactId:"4b83d4a9-f7d3-43ad-ae39-7735f8de7549",recipientEmail:"person@example.jp",cc:[],bcc:[],disableOrganizationCc:false,subject:"御礼",body:"本文",templateId:null,eventId:null,classification:"courtesy",confirmedRecipient:true,confirmationToken:"12345678901234567890.token",idempotencyKey:"e249f0ee-e21a-49fe-b889-97203c38b450",duplicateOverride:false,duplicateOverrideReason:null};
function request(overrides:Partial<typeof input>={}){return new Request("https://app.example.jp/api/gmail/send",{method:"POST",headers:{origin:"https://app.example.jp","content-type":"application/json"},body:JSON.stringify({...input,...overrides})})}
function querySingle(data:unknown){return{select:()=>({eq:()=>({single:async()=>({data,error:null})})})}}
function context(options:{classification?:string;claimError?:boolean;existingStatus?:string;role?:"owner"|"admin"|"member";allowDisable?:boolean}={}){
 const role=options.role??"owner";
 const from=vi.fn((table:string)=>{
  if(table==="contacts")return{select:()=>({eq:()=>({eq:()=>({single:async()=>({data:{id:input.contactId,email:input.recipientEmail,classification:options.classification??"courtesy"}})})})})};
  if(table==="organization_mail_settings")return querySingle({admin_sender_mode:"organization_email",member_sender_mode:"personal_email",auto_cc_organization_email:true,allow_member_to_disable_cc:options.allowDisable??false});
  if(table==="organization_google_connections")return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{google_email:"club@example.jp",encrypted_refresh_token:"encrypted",status:"active"},error:null})})})};
  if(table==="user_google_connections")return{select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{google_email:"member@example.jp",encrypted_refresh_token:"encrypted-user",status:"active"},error:null})})})})};
  if(table==="email_send_requests")return{insert:async()=>({error:options.claimError?{code:"23505"}:null}),select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{status:options.existingStatus}})})})}),update:()=>({eq:async()=>({error:null})})};
  if(table==="email_templates")return{select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})};
  if(table==="email_logs")return{insert:()=>({select:()=>({single:async()=>({data:{id:"log-1"},error:null})})}),update:()=>({eq:()=>({eq:async()=>({error:null})})})};
  return{insert:async()=>({error:null})};
 });
 return{supabase:{from},user:{id:"user-1"},member:{id:"member-1",club_id:"club-1",access_role:role}};
}
beforeEach(()=>{vi.clearAllMocks();mocks.verify.mockReturnValue(true);mocks.send.mockResolvedValue({data:{id:"gmail-1",threadId:"thread-1"}})});

describe("Gmail send route",()=>{
 it("sends once through the organization account and persists only the app attempt",async()=>{mocks.requireMember.mockResolvedValue(context());const response=await POST(request());expect(response.status).toBe(200);expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({from:"club@example.jp",to:"person@example.jp"}))});
 it("routes a member through their personal account and enforces organization CC",async()=>{mocks.requireMember.mockResolvedValue(context({role:"member"}));const response=await POST(request());expect(response.status).toBe(200);expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({from:"member@example.jp",cc:["club@example.jp"]}))});
 it("allows a member to disable automatic CC only when policy permits it",async()=>{mocks.requireMember.mockResolvedValue(context({role:"member",allowDisable:true}));await POST(request({disableOrganizationCc:true}));expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({cc:[]}))});
 it("rejects a changed classification before calling Gmail",async()=>{mocks.requireMember.mockResolvedValue(context({classification:"important"}));const response=await POST(request());expect(response.status).toBe(409);expect(mocks.send).not.toHaveBeenCalled()});
 it("reuses a completed idempotency key without a second Gmail call",async()=>{mocks.requireMember.mockResolvedValue(context({claimError:true,existingStatus:"sent"}));const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({reused:true});expect(mocks.send).not.toHaveBeenCalled()});
});
