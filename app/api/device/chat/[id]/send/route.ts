import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";

// Posts a message in a chat as the device's member ({ body }). The device
// only calls this after they tap Send on the message Fo drafted.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/device/chat/[id]/send">) {
  const hash = bearerHash(request);
  if (!hash) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!text) return NextResponse.json({ error: "Empty message" }, { status: 400 });
  const { error } = await supabaseAdmin().rpc("srv_device_send", { p_token_hash: hash, p_chat: id, p_body: text });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
