import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashIdentifier, normaliseEmail, normalisePhone } from "@/lib/hash";

// Find someone by their email or phone number. What you type is hashed here
// and only the hash is looked up; nothing about other people's contact
// details is ever returned.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.query === "string" ? body.query.trim().slice(0, 200) : "";
  const email = raw.includes("@") ? normaliseEmail(raw) : null;
  const phone = email ? null : normalisePhone(raw);
  if (!email && !phone) {
    return NextResponse.json({ error: "Enter a full email address or phone number (with country code if outside the US)" }, { status: 400 });
  }

  const hash = email ? hashIdentifier("email", email) : hashIdentifier("phone", phone!);
  const { data, error } = await supabaseAdmin().rpc("srv_find_person", { p_user: user.id, p_hash: hash });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, kind: email ? "email" : "phone", normalised: email ?? phone });
}
