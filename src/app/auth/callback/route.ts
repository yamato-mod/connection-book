import { NextResponse, type NextRequest } from "next/server";
import { createCookieClient } from "@/lib/supabase/server";

/**
 * Handles the Supabase PKCE auth callback.
 *
 * Flow:
 *  1. User clicks magic-link email  → Supabase verifies the OTP token
 *  2. Supabase redirects here with ?code=<auth_code>
 *  3. We exchange the code for a session (sets auth cookies)
 *  4. Redirect to the intended page (?next= parameter)
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createCookieClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }

    // Code exchange failed — likely expired or already used
    console.error("[auth/callback] Code exchange failed:", error.message);
  }

  // Fallback: redirect to start page
  return NextResponse.redirect(`${origin}/start`);
}
