import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "@/lib/format";
import type { Profile } from "@/lib/types";

export type Lens = {
  cityId: string; cityName: string; short: string; isLaunched: boolean;
  from: string; to: string; kind: "home" | "trip"; tripId?: string; live?: boolean;
  /** Where your live position puts you right now (live distance on, position under 30 minutes old). */
  here?: boolean;
  /** A planned trip starting today that live distance hasn't put you in yet: you may not have left. */
  unconfirmed?: boolean;
};

/** The cities you're allowed to browse: home, plus each of your current/upcoming trips. */
export async function myLenses(supabase: SupabaseClient, profile: Profile): Promise<Lens[]> {
  const today = todayISO();
  const liveOn = profile.share_live_location && profile.show_distance;
  const [{ data: trips }, { data: cities }, { data: liveCity }] = await Promise.all([
    supabase.from("trips").select("id, city_id, starts_on, ends_on, from_live").eq("user_id", profile.id)
      .gte("ends_on", today).order("starts_on"),
    supabase.from("cities").select("id, name, short_name, is_launched"),
    liveOn ? supabase.rpc("my_live_city") : Promise.resolve({ data: null }),
  ]);
  const city = (id: string) => cities?.find((c) => c.id === id);
  const lenses: Lens[] = [];
  const home = profile.home_city_id ? city(profile.home_city_id) : null;
  if (home) {
    lenses.push({ cityId: home.id, cityName: home.name, short: home.short_name, isLaunched: home.is_launched, from: today, to: today, kind: "home" });
  }
  for (const t of trips ?? []) {
    const c = city(t.city_id);
    if (!c) continue;
    lenses.push({
      cityId: c.id, cityName: c.name, short: c.short_name, isLaunched: c.is_launched, kind: "trip", tripId: t.id, live: t.from_live,
      from: t.starts_on < today ? today : t.starts_on, to: t.ends_on,
      unconfirmed: liveOn && !t.from_live && t.starts_on === today && t.city_id !== liveCity,
    });
  }
  if (typeof liveCity === "string") {
    const here = lenses.find((l) => l.cityId === liveCity && l.from <= today && l.to >= today);
    if (here) here.here = true;
  }
  return lenses;
}

/**
 * Where you are right now: wherever live distance puts you, else a trip covering today
 * (one live distance found first), else home. With live distance on, a planned trip
 * doesn't count on its first day until your live position puts you there.
 */
export function currentLens(lenses: Lens[]) {
  const here = lenses.find((l) => l.here);
  if (here) return here;
  const today = todayISO();
  const now = lenses.filter((l) => l.kind === "trip" && !l.unconfirmed && l.from <= today && l.to >= today);
  return now.find((l) => l.live) ?? now[0] ?? lenses.find((l) => l.kind === "home") ?? lenses[0];
}
