import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashIdentifier, normaliseEmail, normalisePhone } from "@/lib/hash";

// Registers the signed-in user's own email (and optional phone number) as
// hashes, so friends who have them in their contacts can find them.
export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const items: { kind: "phone" | "email"; hash: string }[] = [];

  const email = user.email ? normaliseEmail(user.email) : null;
  if (email) items.push({ kind: "email", hash: hashIdentifier("email", email) });

  if (typeof body?.phone === "string" && body.phone.trim()) {
    const phone = normalisePhone(body.phone);
    if (!phone) return NextResponse.json({ error: "That phone number doesn't look right" }, { status: 400 });
    items.push({ kind: "phone", hash: hashIdentifier("phone", phone) });
  }

  const { data, error } = await supabaseAdmin().rpc("srv_set_identity_hashes", {
    p_user: user.id,
    p_items: items,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const conflicts = (data as string[]) ?? [];
  return NextResponse.json({
    ok: true,
    phoneInUse: conflicts.length > 0 && items.some((i) => i.kind === "phone" && conflicts.includes(i.hash)),
  });
}
