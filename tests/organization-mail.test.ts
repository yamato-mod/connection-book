import {describe,expect,it} from "vitest";
import {canManageOrganization,enforcedCc,isGoogleReauthError,resolveSender,senderModeForRole,type MailSettings} from "../src/lib/organization-mail";
const defaults:MailSettings={admin_sender_mode:"organization_email",member_sender_mode:"personal_email",auto_cc_organization_email:true,allow_member_to_disable_cc:false};

describe("organization mail routing",()=>{
 it("uses organization mail for owner/admin and personal mail for members",()=>{expect(senderModeForRole("owner",defaults)).toBe("organization_email");expect(senderModeForRole("admin",defaults)).toBe("organization_email");expect(senderModeForRole("member",defaults)).toBe("personal_email")});
 it("enforces organization CC for members",()=>{expect(enforcedCc({role:"member",settings:defaults,organizationEmail:"club@example.jp",requestedCc:[],disableOrganizationCc:true})).toEqual(["club@example.jp"])});
 it("allows CC removal only when explicitly enabled",()=>{expect(enforcedCc({role:"member",settings:{...defaults,allow_member_to_disable_cc:true},organizationEmail:"club@example.jp",requestedCc:[],disableOrganizationCc:true})).toEqual([])});
 it("does not give members organization connection management",()=>{expect(canManageOrganization("member")).toBe(false);expect(canManageOrganization("admin")).toBe(true)});
 it("resolves a member's personal sender independently of the organization connection",()=>{
  expect(resolveSender({role:"member",settings:defaults,organizationGoogle:{google_email:"club@example.jp",status:"active"},userGoogle:null})).toEqual({mode:"personal_email",email:null,state:"not_connected",fixableBy:"self"});
 });
 it("lets members see the organization sender when the policy routes them through it",()=>{
  const settings={...defaults,member_sender_mode:"organization_email" as const};
  expect(resolveSender({role:"member",settings,organizationGoogle:{google_email:"club@example.jp",status:"active"},userGoogle:null})).toEqual({mode:"organization_email",email:"club@example.jp",state:"ready",fixableBy:"manager"});
 });
 it("flags revoked or errored connections as needing reconnection rather than ready",()=>{
  expect(resolveSender({role:"admin",settings:defaults,organizationGoogle:{google_email:"club@example.jp",status:"revoked"},userGoogle:null}).state).toBe("needs_reconnect");
  expect(resolveSender({role:"owner",settings:defaults,organizationGoogle:{google_email:"club@example.jp",status:"error"},userGoogle:null}).state).toBe("needs_reconnect");
 });
 it("detects Google invalid_grant errors",()=>{
  expect(isGoogleReauthError({response:{data:{error:"invalid_grant"}}})).toBe(true);
  expect(isGoogleReauthError(new Error("invalid_grant: Token has been expired or revoked."))).toBe(true);
  expect(isGoogleReauthError(new Error("Quota exceeded"))).toBe(false);
 });
});
