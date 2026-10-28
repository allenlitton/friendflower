import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { APPLE_APP_CLIENT_ID, appleSignInConfigured, exchangeAppleCode, saveAppleToken } from "@/lib/apple-sign-in";

// After Sign in with Apple in the iPhone app, the app sends Apple's one-time code here.
// We swap it for a refresh token so deleting the account can end the Apple sign-in.
export async function POST(request: Request) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const code: unknown = (await request.json().catch(() => null))?.code;
  if (typeof code !== "string" || !code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  if (!appleSignInConfigured()) return NextResponse.json({ ok: false });

  const token = await exchangeAppleCode(code, APPLE_APP_CLIENT_ID);
  if (token) await saveAppleToken(user.id, APPLE_APP_CLIENT_ID, token);
  return NextResponse.json({ ok: !!token });
}
