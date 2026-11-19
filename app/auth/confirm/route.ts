import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { APPLE_WEB_CLIENT_ID, saveAppleToken } from "@/lib/apple-sign-in";

// The sign-in email's link lands here, and so does Apple or Google sign-in on the website.
// Handles both Supabase's default email and OAuth (which send ?code=…) and our custom
// email template (?token_hash=…).
// People can also type the 6-digit code once the custom template is set up.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // Apple or Google sent them back without signing in (they cancelled, or it failed).
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL("/signin?error=provider", url.origin));

  const supabase = await supabaseServer();
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Kept so deleting the account can also end the Apple sign-in, as Apple requires.
      const refresh = data.session?.provider_refresh_token;
      if (refresh && APPLE_WEB_CLIENT_ID && data.user?.app_metadata?.provider === "apple") {
        await saveAppleToken(data.user.id, APPLE_WEB_CLIENT_ID, refresh).catch(() => {});
      }
      return NextResponse.redirect(new URL(safeNext, url.origin));
    }
  } else if (token_hash) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/signin?error=link", url.origin));
}
