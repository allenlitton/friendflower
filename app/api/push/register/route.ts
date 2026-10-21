import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// APNs device tokens are 32+ bytes written as hex. Anything else isn't one.
const TOKEN = /^[0-9a-f]{64,200}$/i;

async function who(request: Request) {
  const { data: { user } } = await (await supabaseServer()).auth.getUser();
  const token: unknown = (await request.json().catch(() => null))?.token;
  return { user, token: typeof token === "string" && TOKEN.test(token) ? token.toLowerCase() : null };
}

// The iPhone app registers (POST) or stops (DELETE) notifications for this device.
export async function POST(request: Request) {
  const { user, token } = await who(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (!token) return NextResponse.json({ error: "Bad device token" }, { status: 400 });
  const { error } = await supabaseAdmin().rpc("srv_push_register", { p_user: user.id, p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const { user, token } = await who(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (!token) return NextResponse.json({ error: "Bad device token" }, { status: 400 });
  const { error } = await supabaseAdmin().rpc("srv_push_unregister", { p_user: user.id, p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
