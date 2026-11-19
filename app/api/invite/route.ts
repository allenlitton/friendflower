import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Carries an invite through the App Store install (see the invite_handoff migration).
// POST { code }: an iPhone without the app is about to leave for the App Store.
// GET: a brand-new user in the app asks "did I arrive through someone's invite?".

function ipHash(request: NextRequest) {
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const pepper = process.env.CONTACT_HASH_PEPPER;
  if (!ip || !pepper) return null;
  return createHash("sha256").update(`${pepper}|invite-ip|${ip}`).digest("hex");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.slice(0, 64) : "";
  const hash = ipHash(request);
  if (code && hash) await supabaseAdmin().rpc("srv_note_invite_handoff", { p_ip_hash: hash, p_code: code });
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const hash = ipHash(request);
  if (!user || !hash) return NextResponse.json({ code: null });
  const { data } = await supabaseAdmin().rpc("srv_take_invite_handoff", { p_ip_hash: hash });
  return NextResponse.json({ code: (data as string | null) ?? null });
}
