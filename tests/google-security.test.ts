import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {decryptGoogleToken,encryptGoogleToken} from "../src/lib/google-token-crypto";
import {issueGoogleOAuthState,verifyGoogleOAuthState} from "../src/lib/google-oauth-state";

beforeEach(()=>{process.env.GOOGLE_TOKEN_ENCRYPTION_KEY=Buffer.alloc(32,7).toString("base64");process.env.GOOGLE_OAUTH_STATE_SECRET="oauth-state-secret-that-is-longer-than-32-characters"});
describe("Google credential boundaries",()=>{
 it("encrypts refresh tokens with authenticated encryption",()=>{const encrypted=encryptGoogleToken("refresh-token");expect(encrypted).not.toContain("refresh-token");expect(decryptGoogleToken(encrypted)).toBe("refresh-token")});
 it("binds OAuth state to type, organization, member, nonce and expiry",()=>{const state=issueGoogleOAuthState({type:"user",clubId:"club-1",memberId:"member-1",role:"member",nonce:"nonce-1",expiresAt:Date.now()+60_000});expect(verifyGoogleOAuthState(state)).toMatchObject({type:"user",clubId:"club-1",memberId:"member-1",nonce:"nonce-1"});expect(verifyGoogleOAuthState(`${state}x`)).toBeNull()});
});
