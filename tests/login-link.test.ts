import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";

describe("login link via organization Gmail",()=>{
  const route=readFileSync(join(process.cwd(),"src/app/api/auth/login-link/route.ts"),"utf8");
  const callback=readFileSync(join(process.cwd(),"src/app/auth/callback/route.ts"),"utf8");
  it("rate limits per email and per IP before sending",()=>{
    expect(route).toContain("PER_EMAIL_INTERVAL_MS");
    expect(route).toContain("PER_IP_HOURLY");
    expect(route.indexOf("login_link_requests")).toBeLessThan(route.indexOf("generateLink"));
  });
  it("falls back to Supabase mail when no organization Gmail can send",()=>{
    expect(route).toContain("fallback: true");
  });
  it("only redirects to in-app paths after verifying the token",()=>{
    expect(callback).toContain('requestedNext.startsWith("/") && !requestedNext.startsWith("//")');
    expect(callback).toContain("verifyOtp");
  });
});

describe("login link does not create accounts for unknown emails",()=>{
  const route=readFileSync(join(process.cwd(),"src/app/api/auth/login-link/route.ts"),"utf8");
  it("looks the person up before generating a link, and only generates once a club Gmail can send",()=>{
    expect(route.indexOf("auth_user_id_by_email")).toBeGreaterThan(-1);
    expect(route.indexOf("auth_user_id_by_email")).toBeLessThan(route.indexOf("generateLink"));
    expect(route.indexOf("organization_google_connections")).toBeLessThan(route.indexOf("generateLink"));
  });
});

describe("writes on a contact require the right to view it",()=>{
  const app=readFileSync(join(process.cwd(),"src/app/api/app/route.ts"),"utf8");
  it("checks view rights before notes, follow-ups and tags",()=>{
    for(const action of ['input.action === "create_followup"','input.action === "add_note"','input.action==="set_contact_tags"']){
      const at=app.indexOf(action);
      expect(at).toBeGreaterThan(-1);
      expect(app.slice(at,at+200)).toContain("contactViewDenied");
    }
  });
  it("checks view rights before a thank-you mail or draft",()=>{
    for(const file of ["src/app/api/gmail/confirmation/route.ts","src/app/api/gmail/draft/route.ts"])expect(readFileSync(join(process.cwd(),file),"utf8")).toContain("canViewContactDetails(member,contact)");
  });
});
