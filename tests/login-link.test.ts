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
