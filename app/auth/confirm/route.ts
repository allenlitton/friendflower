import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";

// The sign-in email's link lands here. Handles both Supabase's default email
// (which sends ?code=…) and our custom template (?token_hash=…).
// People can also type the 6-digit code once the custom template is set up.
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const token_hash = url.searchParams.get("token_hash");
  const type = (url.searchParams.get("type") ?? "email") as EmailOtpType;
  const next = url.searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const supabase = await supabaseServer();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : token_hash
      ? await supabase.auth.verifyOtp({ type, token_hash })
      : { error: new Error("missing token") };

  if (!error) {
    return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/signin?error=link", url.origin));
}
