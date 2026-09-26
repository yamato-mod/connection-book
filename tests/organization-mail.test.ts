import {describe,expect,it} from "vitest";
import {canManageOrganization,enforcedCc,senderModeForRole,type MailSettings} from "../src/lib/organization-mail";
const defaults:MailSettings={admin_sender_mode:"organization_email",member_sender_mode:"personal_email",auto_cc_organization_email:true,allow_member_to_disable_cc:false};

describe("organization mail routing",()=>{
 it("uses organization mail for owner/admin and personal mail for members",()=>{expect(senderModeForRole("owner",defaults)).toBe("organization_email");expect(senderModeForRole("admin",defaults)).toBe("organization_email");expect(senderModeForRole("member",defaults)).toBe("personal_email")});
 it("enforces organization CC for members",()=>{expect(enforcedCc({role:"member",settings:defaults,organizationEmail:"club@example.jp",requestedCc:[],disableOrganizationCc:true})).toEqual(["club@example.jp"])});
 it("allows CC removal only when explicitly enabled",()=>{expect(enforcedCc({role:"member",settings:{...defaults,allow_member_to_disable_cc:true},organizationEmail:"club@example.jp",requestedCc:[],disableOrganizationCc:true})).toEqual([])});
 it("does not give members organization connection management",()=>{expect(canManageOrganization("member")).toBe(false);expect(canManageOrganization("admin")).toBe(true)});
});
