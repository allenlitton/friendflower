import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";

// Everything the round device's screens show (Home, Nearby, Chats, Trips,
// Places), for the member it's linked to. 401 once the device is removed.
export async function GET(request: Request) {
  const hash = bearerHash(request);
  if (!hash) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const { data, error } = await supabaseAdmin().rpc("srv_device_summary", { p_token_hash: hash });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.linked) return NextResponse.json({ linked: false }, { status: 401 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
