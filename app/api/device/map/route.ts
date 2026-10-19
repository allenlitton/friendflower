import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bearerHash } from "@/lib/device";
import { mapImage, type MapView } from "@/lib/device-image";

// The Places map for the round device: a dark street map with a pin for each
// place on its Places page, as raw RGB565 pixels. It's drawn `w`×`h`, bigger
// than the device's `vw`×`vh` window so it can be dragged. Without `z`, `lat`
// and `lng` the window is framed to fit the places; with them, it's that zoom
// and centre. `x-map` is "zoom,lat,lng|x,y;x,y;..." : the view it was drawn at,
// then each pin's position in the same order as the places, so the device can
// number them to match its list.
export async function GET(request: Request) {
  const hash = bearerHash(request);
  if (!hash) return NextResponse.json({ error: "Missing device key" }, { status: 401 });
  const url = new URL(request.url);
  const size = (name: string, fallback: number) => Math.min(Math.max(Number(url.searchParams.get(name)) || fallback, 64), 800);
  const w = size("w", 340), h = size("h", 220);
  const vw = Math.min(size("vw", w), w), vh = Math.min(size("vh", h), h);
  const z = Number(url.searchParams.get("z")), lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
  const view: MapView | undefined = url.searchParams.has("z") && Number.isFinite(z) && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) < 85 && Math.abs(lng) <= 180 ? { z, lat, lng } : undefined;

  const { data, error } = await supabaseAdmin().rpc("srv_device_summary", { p_token_hash: hash });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.linked) return NextResponse.json({ linked: false }, { status: 401 });
  const places = ((data.places ?? []) as { lat: number | null; lng: number | null }[])
    .filter((p): p is { lat: number; lng: number } => typeof p.lat === "number" && typeof p.lng === "number");
  if (!places.length) return NextResponse.json({ error: "No places" }, { status: 404 });

  try {
    const map = await mapImage(places, w, h, vw, vh, view);
    const header = `${map.view.z},${map.view.lat.toFixed(6)},${map.view.lng.toFixed(6)}|` + map.pins.map((p) => `${p.x},${p.y}`).join(";");
    return new NextResponse(new Uint8Array(map.pixels), {
      headers: {
        "content-type": "application/octet-stream", "x-width": String(w), "x-height": String(h),
        "x-map": header, "cache-control": "private, max-age=600",
      },
    });
  } catch (e) {
    console.error("Device map failed", e);
    return NextResponse.json({ error: "Map unavailable" }, { status: 502 });
  }
}
