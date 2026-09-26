import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {issueConfirmationToken,verifyConfirmationToken} from "../src/lib/confirmation-token";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {assertSameOrigin,requireMember,requireOrganizationManager} from "../src/lib/server-auth";

const expected={userId:"user-1",contactId:"contact-1",email:"person@example.jp"};
describe("recipient confirmation token",()=>{
  beforeEach(()=>{process.env.MAIL_CONFIRMATION_SECRET="a-secure-test-secret-that-is-over-32-characters"});
  afterEach(()=>vi.useRealTimers());
  it("binds the token to sender, contact and recipient",()=>{const token=issueConfirmationToken({...expected,expiresAt:Date.now()+300_000});expect(verifyConfirmationToken(token,expected)).toBe(true);expect(verifyConfirmationToken(token,{...expected,email:"other@example.jp"})).toBe(false);expect(verifyConfirmationToken(token,{...expected,userId:"user-2"})).toBe(false)});
  it("rejects an expired or tampered token",()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-09-16T00:00:00Z"));const token=issueConfirmationToken({...expected,expiresAt:Date.now()+1_000});vi.advanceTimersByTime(1_001);expect(verifyConfirmationToken(token,expected)).toBe(false);expect(verifyConfirmationToken(`${token}x`,expected)).toBe(false)});
});

describe("authenticated API boundary",()=>{
  it("rejects requests without a Supabase bearer session",async()=>{await expect(requireMember(new Request("https://app.example.jp/api/app"))).rejects.toMatchObject({status:401})});
  it("rejects cross-origin mutations",()=>{expect(()=>assertSameOrigin(new Request("https://app.example.jp/api/app",{headers:{origin:"https://evil.example"}}))).toThrow()});
  it("prevents members from managing the organization Google connection",()=>{expect(()=>requireOrganizationManager({access_role:"member"})).toThrow();expect(()=>requireOrganizationManager({access_role:"admin"})).not.toThrow()});
});

describe("database security contract",()=>{
  const initial=readFileSync(join(process.cwd(),"supabase/migrations/20260915150119_initial_crm_schema.sql"),"utf8");
  const live=readFileSync(join(process.cwd(),"supabase/migrations/20260916090000_connect_live_backend.sql"),"utf8");
  const organization=readFileSync(join(process.cwd(),"supabase/migrations/20260918055602_organization_crm_google_connections.sql"),"utf8");
  it("enables RLS and isolates rows through current_club_id",()=>{expect(initial).toContain("enable row level security");expect(initial).toContain("private.current_club_id()");expect(initial).toContain("revoke all on all tables in schema public from anon, authenticated")});
  it("keeps operational integration jobs server-write only",()=>{expect(live).toContain("alter table public.integration_jobs enable row level security");expect(live).toContain("revoke all on public.integration_jobs from anon, authenticated")});
  it("registers contact, card, note and event atomically",()=>{expect(live).toContain("function public.register_business_card_contact");expect(live).toContain("insert into public.business_cards");expect(live).toContain("insert into public.event_contacts")});
  it("keeps both Google token stores inaccessible to browser roles",()=>{expect(organization).toContain("revoke all on public.organization_google_connections from anon, authenticated");expect(organization).toContain("revoke all on public.user_google_connections from anon, authenticated");expect(organization).toContain("enable row level security")});
  it("migrates the linked administrator to owner without adding orphan Auth users",()=>{expect(organization).toContain("where is_admin and is_active and auth_user_id is not null");expect(organization).not.toContain("from auth.users")});
  it("limits member email history to their own app-originated sends",()=>{expect(organization).toContain("email_logs_role_read");expect(organization).toContain("sender_member_id = (select private.current_member_id())")});
  it("transfers owner without deleting organization data",()=>{const transfer=organization.slice(organization.indexOf("function public.transfer_organization_owner"),organization.indexOf("revoke all on function public.transfer_organization_owner"));expect(transfer).toContain("update public.members");expect(transfer).not.toContain("delete from")});
});
