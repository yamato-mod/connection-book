import { describe, expect, it } from "vitest";
import { createClientId, sha256Fallback } from "@/lib/client-crypto";

describe("insecure-origin crypto fallbacks", () => {
  it("computes the standard SHA-256 digest", () => {
    expect(sha256Fallback(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("creates UUID-shaped client identifiers", () => {
    expect(createClientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
