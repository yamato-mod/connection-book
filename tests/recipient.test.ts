import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { isAllowedRecipient } from "@/lib/recipient";

function client(noteHits: number) {
  const calls: string[] = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "ilike"]) chain[name] = (...args: unknown[]) => { calls.push(`${name}:${args.join(",")}`); return chain; };
  chain.limit = async () => ({ data: Array.from({ length: noteHits }, (_, i) => ({ id: String(i) })), error: null });
  return { supabase: { from: () => chain } as never, calls };
}
const contact = { id: "c1", email: "Old@Example.jp" };

describe("isAllowedRecipient", () => {
  it("accepts the registered address without looking at notes", async () => {
    const { supabase, calls } = client(0);
    expect(await isAllowedRecipient(supabase, "club", contact, "old@example.jp")).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it("accepts an address recorded by a 併記 merge note", async () => {
    const { supabase, calls } = client(1);
    expect(await isAllowedRecipient(supabase, "club", contact, "new_card@example.jp")).toBe(true);
    expect(calls.find((c) => c.startsWith("ilike"))).toContain("%メール: new\\_card@example.jp%");
  });
  it("rejects an address that is neither registered nor recorded", async () => {
    const { supabase } = client(0);
    expect(await isAllowedRecipient(supabase, "club", contact, "someone@example.jp")).toBe(false);
  });
});
