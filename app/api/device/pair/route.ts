import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deviceSecretHash } from "@/lib/device";

// The round device asks for a short code to show on screen. The member then
// types it at friendflower.app/device to link the device to their account.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const hash = deviceSecretHash(body?.secret);
  if (!hash) return NextResponse.json({ error: "Bad device secret" }, { status: 400 });
  const { data, error } = await supabaseAdmin().rpc("srv_device_pair_start", { p_secret_hash: hash });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
