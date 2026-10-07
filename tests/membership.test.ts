import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canActOnMember, canSuspend, canViewContactDetails, limitContact, membershipGate, searchableText } from "../src/lib/membership";

const owner = { id: "o", access_role: "owner", position: "representative" };
const vice = { id: "v", access_role: "admin", position: "vice_representative" };
const exec = { id: "e", access_role: "admin", position: "executive" };
const member = { id: "m", access_role: "member", position: "member", library_access: false };
const approved = { ...member, id: "m2", library_access: true };

describe("名刺ライブラリの閲覧（人物名と所属だけ／詳細は幹部・承認者・登録者）", () => {
  const contact = { id: "c", created_by: "someone", name: "山田 太郎", company_name: "株式会社サンプル", university_name: "", organization_name: "", email: "taro@example.jp", phone: "082-000-0000", role: "部長" };
  it("officers and approved members see details", () => {
    expect(canViewContactDetails(exec, contact)).toBe(true);
    expect(canViewContactDetails(approved, contact)).toBe(true);
  });
  it("a member sees details only of cards they registered", () => {
    expect(canViewContactDetails(member, contact)).toBe(false);
    expect(canViewContactDetails(member, { created_by: "m" })).toBe(true);
    expect(canViewContactDetails(member, { created_by: null })).toBe(false);
  });
  it("limited view exposes name and affiliation only", () => {
    const limited = limitContact(contact);
    expect(limited).toEqual({ restricted: true, id: "c", name: "山田 太郎", company_name: "株式会社サンプル", university_name: "", organization_name: "" });
    expect(JSON.stringify(limited)).not.toContain("taro@example.jp");
  });
  it("restricted search cannot probe hidden fields", () => {
    expect(searchableText(contact, false)).not.toContain("taro@example.jp");
    expect(searchableText(contact, false)).toContain("株式会社サンプル");
    expect(searchableText(contact, true)).toContain("taro@example.jp");
  });
});

describe("部員の状態（第7・10・11・35条）", () => {
  it("lets active and on-leave members in", () => {
    expect(membershipGate({ status: "active" }).ok).toBe(true);
    expect(membershipGate({ status: "on_leave" }).ok).toBe(true);
  });
  it("keeps applicants, suspended and withdrawn members out with a reason", () => {
    expect(membershipGate({ status: "pending" })).toMatchObject({ ok: false, error: "membership_pending" });
    expect(membershipGate({ status: "withdrawn" })).toMatchObject({ ok: false, error: "membership_withdrawn" });
    const now = new Date("2026-10-07T00:00:00Z");
    expect(membershipGate({ status: "suspended", suspended_until: "2026-10-20T00:00:00Z" }, now)).toMatchObject({ ok: false, error: "membership_suspended" });
  });
  it("ends a time-limited suspension automatically", () => {
    expect(membershipGate({ status: "suspended", suspended_until: "2026-10-01T00:00:00Z" }, new Date("2026-10-07T00:00:00Z")).ok).toBe(true);
  });
});

describe("役員の権限（第13〜17・35条）", () => {
  it("only 代表 and 副代表 can suspend", () => {
    expect(canSuspend(owner)).toBe(true);
    expect(canSuspend(vice)).toBe(true);
    expect(canSuspend(exec)).toBe(false);
    expect(canSuspend(member)).toBe(false);
  });
  it("幹部 act on 部員 only; 代表 on everyone except themself", () => {
    expect(canActOnMember(exec, { id: "m", access_role: "member" })).toBe(true);
    expect(canActOnMember(exec, { id: "v", access_role: "admin" })).toBe(false);
    expect(canActOnMember(owner, { id: "v", access_role: "admin" })).toBe(true);
    expect(canActOnMember(owner, { id: "o", access_role: "owner" })).toBe(false);
    expect(canActOnMember(vice, { id: "o", access_role: "owner" })).toBe(false);
    expect(canActOnMember(member, { id: "x", access_role: "member" })).toBe(false);
  });
});

describe("database contract for the bylaws migration", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261007120000_bylaws_membership.sql"), "utf8");
  it("derives is_active from status so a withdrawn or suspended member cannot pass auth checks", () => {
    expect(sql).toContain("new.is_active := new.status in ('active', 'on_leave')");
  });
  it("keeps position, access_role and is_admin consistent", () => {
    expect(sql).toContain("members_position_access_role_consistency");
    expect(sql).toContain("new.is_admin := new.access_role in ('owner', 'admin')");
  });
  it("closes direct browser reads so visibility rules can't be bypassed", () => {
    expect(sql).toContain("revoke select on all tables in schema public from anon, authenticated");
    expect(sql).toContain("revoke all on public.library_access_requests from anon, authenticated");
  });
});
