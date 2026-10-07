import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

describe("organization onboarding security contract",()=>{
  const migration=readFileSync(join(process.cwd(),"supabase/migrations/20260918080617_organization_self_service_onboarding.sql"),"utf8");
  const page=readFileSync(join(process.cwd(),"src/app/start/page.tsx"),"utf8");

  it("creates the organization, owner, policy, template and audit record atomically",()=>{
    expect(migration).toContain("function public.create_organization_for_user");
    expect(migration).toContain("insert into public.clubs");
    expect(migration).toContain("insert into public.members");
    expect(migration).toContain("'owner'");
    expect(migration).toContain("insert into public.organization_mail_settings");
    expect(migration).toContain("insert into public.email_templates");
    expect(migration).toContain("'organization_created'");
  });

  it("prevents duplicate organizations for one Auth user and serializes retries",()=>{
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("where auth_user_id = p_auth_user_id");
    expect(migration).toContain("User already belongs to an organization");
  });

  it("keeps the onboarding RPC server-only",()=>{
    expect(migration).toContain("security invoker");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });

  // 組織コードでの入部申請には、先にログイン（Authユーザー）が必要。
  // ログインできるだけでは何も見られず、代表または幹部が承認するまで pending のまま。
  it("lets new people sign in so they can apply with an invite code, without granting access",()=>{
    const joinRoute=readFileSync(join(process.cwd(),"src/app/api/onboarding/join/route.ts"),"utf8");
    expect(page).toContain("shouldCreateUser:true");
    expect(joinRoute).toContain('status: "pending"');
    expect(page).not.toContain("Signups not allowed");
    expect(page).toContain('setIntent("member")');
    expect(page).toContain('setIntent("create")');
  });
});
