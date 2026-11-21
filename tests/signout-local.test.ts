import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ログアウト", () => {
  it("この端末だけログアウトし、同じアカウントの他の端末は切らない", () => {
    for (const file of ["src/app/start/page.tsx", "src/components/device-settings.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).toContain('signOut({scope:"local"})');
      expect(source).not.toMatch(/auth\.signOut\(\)/);
    }
  });
});
