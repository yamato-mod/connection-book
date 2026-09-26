import { describe, expect, it } from "vitest";
import { isConfiguredSupabaseUrl, isConfiguredValue, isSupabaseBrowserConfigured } from "@/lib/env-config";

describe("environment configuration validation", () => {
  it.each([undefined, "", "https://YOUR_PROJECT.supabase.co", "sb_publishable_xxx", "sb_secret_xxx", "replace-with-at-least-32-random-characters"])("rejects placeholder %s", (value) => {
    expect(isConfiguredValue(value)).toBe(false);
  });

  it("accepts a real-looking Supabase configuration", () => {
    expect(isConfiguredSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co")).toBe(true);
    expect(isSupabaseBrowserConfigured("https://abcdefghijklmnopqrst.supabase.co", "sb_publishable_abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
  });
});
