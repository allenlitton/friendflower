import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";

// One chat for the round device: who's in it and its last 20 messages.
// Opening it marks it read, as on the site.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/device/chat/[id]">) {
  const hash = bearerHash(request);
  if (!hash) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const { id } = await ctx.params;
  const { data, error } = await supabaseAdmin().rpc("srv_device_chat", { p_token_hash: hash, p_chat: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (data?.linked === false) return NextResponse.json({ linked: false }, { status: 401 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
