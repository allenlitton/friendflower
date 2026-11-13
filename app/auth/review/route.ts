import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// App Store reviewers can't read our sign-in emails, so one allow-listed email
// (REVIEW_EMAIL) also accepts a fixed code (REVIEW_CODE). Unset either to turn it off.
// The code must be at least 8 digits so it can't be guessed.
// Sent without a code, it only says whether the email is the review one, so the form
// can still move on to the code step when Supabase won't send another email yet.
export async function POST(request: NextRequest) {
  const { email, code } = await request.json().catch(() => ({}));
  const reviewEmail = process.env.REVIEW_EMAIL?.trim().toLowerCase();
  const reviewCode = process.env.REVIEW_CODE?.trim() ?? "";
  const isReview = !!reviewEmail && /^\d{8,10}$/.test(reviewCode) && String(email ?? "").trim().toLowerCase() === reviewEmail;

  if (code === undefined) return NextResponse.json({ review: isReview });
  if (!isReview || !sameCode(String(code).trim(), reviewCode)) {
    return NextResponse.json({ error: "That code didn't work." }, { status: 401 });
  }

  // Mint a one-time sign-in token for the review account and redeem it here,
  // which sets the same session cookies as a normal email sign-in.
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: "magiclink", email: reviewEmail! });
  if (error) return NextResponse.json({ error: "Couldn't sign in." }, { status: 500 });

  const supabase = await supabaseServer();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (verifyError) return NextResponse.json({ error: "Couldn't sign in." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

function sameCode(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
