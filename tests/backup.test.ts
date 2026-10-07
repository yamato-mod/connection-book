import {describe,expect,it,vi} from "vitest";
import {randomBytes} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({})}));
import {decryptBackup,encryptBackup} from "../src/lib/backup";

describe("encrypted backup",()=>{
  it("round-trips Japanese data and rejects the wrong key",()=>{
    const key=randomBytes(32),json=JSON.stringify({tables:{contacts:[{name:"山田 太郎",email:"taro@example.jp"}]}});
    const file=encryptBackup(json,key);
    expect(file.subarray(0,5).toString()).toBe("TSBK1");
    expect(file.includes(Buffer.from("taro@example.jp"))).toBe(false);
    expect(decryptBackup(file,key)).toBe(json);
    expect(()=>decryptBackup(file,randomBytes(32))).toThrow();
  });
  it("never backs up Google tokens or 2FA records",()=>{
    const source=readFileSync(join(process.cwd(),"src/lib/backup.ts"),"utf8");
    const tables=source.slice(source.indexOf("const TABLES"),source.indexOf("] as const"));
    for(const secret of ["organization_google_connections","user_google_connections","owner_2fa","login_link_requests"])expect(tables).not.toContain(secret);
  });
  it("only lets Vercel Cron start the scheduled backup",()=>{
    const cron=readFileSync(join(process.cwd(),"src/app/api/cron/backup/route.ts"),"utf8");
    expect(cron).toContain("Bearer ${secret}");
    expect(cron).toContain("if (!secret ||");
  });
});
