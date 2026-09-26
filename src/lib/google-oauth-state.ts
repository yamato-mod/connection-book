import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AccessRole } from "@/lib/organization-mail";

export type GoogleConnectionType = "organization" | "user";
type Payload = { type: GoogleConnectionType; clubId: string; memberId: string; role: AccessRole; nonce: string; expiresAt: number };

function secret() {
  const value = process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.MAIL_CONFIRMATION_SECRET;
  if (!value || value.length < 32) throw new Error("GOOGLE_OAUTH_STATE_SECRET is not configured");
  return value;
}

export function issueGoogleOAuthState(payload: Payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyGoogleOAuthState(state: string): Payload | null {
  const [encoded, signature] = state.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", secret()).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
  return payload.expiresAt > Date.now() ? payload : null;
}
