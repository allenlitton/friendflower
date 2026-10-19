import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";
import { avatarImage } from "@/lib/device-image";

// A member's round photo for the round device, as raw RGB565A8 pixels
// (?size=56, &halo=1 for petals behind it). Only for people the device's
// member can already see: themselves, their circle and their chats.
// `x-photo: 0` means there's no photo, just their gradient for initials.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/device/avatar/[id]">) {
  const hash = bearerHash(request);
  if (!hash) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const size = Math.min(Math.max(Number(url.searchParams.get("size")) || 56, 16), 160);
  const halo = url.searchParams.get("halo") === "1";

  const admin = supabaseAdmin();
  const { data: ok } = await admin.rpc("srv_device_can_see", { p_token_hash: hash, p_person: id });
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: profile } = await admin.from("profiles").select("avatar_url").eq("id", id).maybeSingle();

  const pixels = await avatarImage({ id, src: profile?.avatar_url ?? null, size, halo });
  return new NextResponse(new Uint8Array(pixels), {
    headers: {
      "content-type": "application/octet-stream", "x-width": String(size), "x-height": String(size),
      "x-photo": profile?.avatar_url ? "1" : "0", "cache-control": "private, max-age=3600",
    },
  });
}
