import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CityOption } from "@/lib/types";

// City search for "Currently living in": cities we already have, plus any
// city in the world from the Open-Meteo geocoder (GeoNames data, no API key).
// Picking a geocoder result adds it as a city (not launched: no live map).

const GEO = "https://geocoding-api.open-meteo.com/v1";

type GeoPlace = {
  id: number; name: string; latitude: number; longitude: number; feature_code?: string;
  country?: string; admin1?: string; timezone?: string; population?: number;
};
type DbCity = { id: string; name: string; country: string; region: string | null; lat: number; lng: number; is_launched: boolean; geoname_id: number | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Populated places only (cities, towns), not countries, rivers or airports.
const isPlace = (g: GeoPlace) => !!g.feature_code?.startsWith("PPL") && !!g.country;

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

/** A city we already have that is this geocoder place (same GeoNames id, or same name close by). */
function existing(g: GeoPlace, cities: DbCity[]) {
  return cities.find((c) => c.geoname_id === g.id)
    ?? cities.find((c) => norm(c.name) === norm(g.name) && km(c.lat, c.lng, g.latitude, g.longitude) < 40);
}

async function signedIn() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : null;
}

const CITY_COLS = "id, name, country, region, lat, lng, is_launched, geoname_id";

export async function GET(request: NextRequest) {
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const [db, geo] = await Promise.all([
    supabase.from("cities").select(CITY_COLS).ilike("name", `%${q.replace(/[%_\\]/g, "")}%`).limit(8),
    fetch(`${GEO}/search?${new URLSearchParams({ name: q, count: "10", language: "en", format: "json" })}`, { next: { revalidate: 86400 } })
      .then((r) => (r.ok ? r.json() : { results: [] }))
      .catch(() => ({ results: [] })) as Promise<{ results?: GeoPlace[] }>,
  ]);
  const places = (geo.results ?? []).filter(isPlace);

  // Geocoder hits we already have become those cities, so there's one row per real city.
  const known = await nearbyCities(supabase, places);
  const results: CityOption[] = [];
  const seen = new Set<string>();
  const push = (o: CityOption) => {
    const key = o.id ?? `g${o.geonameId}`;
    if (!seen.has(key)) { seen.add(key); results.push(o); }
  };
  for (const c of (db.data ?? []) as DbCity[]) {
    push({ id: c.id, name: c.name, detail: [c.region, c.country].filter(Boolean).join(", "), launched: c.is_launched });
  }
  for (const g of places) {
    const c = existing(g, known);
    push(c
      ? { id: c.id, name: c.name, detail: [c.region ?? g.admin1, c.country].filter(Boolean).join(", "), launched: c.is_launched }
      : { geonameId: g.id, name: g.name, detail: [g.admin1, g.country].filter(Boolean).join(", "), launched: false });
  }
  return NextResponse.json({ results: results.slice(0, 10) });
}

// Add a geocoder city (fetched again here, so the client can't make one up).
export async function POST(request: Request) {
  const supabase = await signedIn();
  if (!supabase) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.geonameId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a city from the list" }, { status: 400 });

  const g = await fetch(`${GEO}/get?id=${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) as GeoPlace | null;
  if (!g || !isPlace(g)) return NextResponse.json({ error: "Couldn't find that city. Try another spelling." }, { status: 400 });

  const known = existing(g, await nearbyCities(supabase, [g]));
  if (known) return NextResponse.json({ id: known.id, name: known.name, launched: known.is_launched });

  const { data, error } = await supabaseAdmin().rpc("srv_add_city", {
    p_geoname_id: g.id, p_name: g.name, p_region: g.admin1 ?? null, p_country: g.country,
    p_lat: g.latitude, p_lng: g.longitude, p_timezone: g.timezone ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data as string, name: g.name, launched: false });
}

/** Cities we have near any of these places (a rough box around each). */
async function nearbyCities(supabase: SupabaseClient, places: GeoPlace[]) {
  if (!places.length) return [];
  const ids = places.map((g) => g.id).join(",");
  const boxes = places.map((g) =>
    `and(lat.gte.${g.latitude - 0.5},lat.lte.${g.latitude + 0.5},lng.gte.${g.longitude - 0.7},lng.lte.${g.longitude + 0.7})`);
  const { data } = await supabase.from("cities").select(CITY_COLS).or([`geoname_id.in.(${ids})`, ...boxes].join(","));
  return (data ?? []) as DbCity[];
}
