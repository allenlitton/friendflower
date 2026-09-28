import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "@/lib/format";
import type { Profile } from "@/lib/types";

export type Lens = {
  cityId: string; cityName: string; short: string; isLaunched: boolean;
  from: string; to: string; kind: "home" | "trip"; tripId?: string; live?: boolean;
};

/** The cities you're allowed to browse: home, plus each of your current/upcoming trips. */
export async function myLenses(supabase: SupabaseClient, profile: Profile): Promise<Lens[]> {
  const today = todayISO();
  const [{ data: trips }, { data: cities }] = await Promise.all([
    supabase.from("trips").select("id, city_id, starts_on, ends_on, from_live").eq("user_id", profile.id)
      .gte("ends_on", today).order("starts_on"),
    supabase.from("cities").select("id, name, short_name, is_launched"),
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
    });
  }
  return lenses;
}

/** Where you are right now: a trip covering today (one live distance found first), else home. */
export function currentLens(lenses: Lens[]) {
  const today = todayISO();
  const now = lenses.filter((l) => l.kind === "trip" && l.from <= today && l.to >= today);
  return now.find((l) => l.live) ?? now[0] ?? lenses.find((l) => l.kind === "home") ?? lenses[0];
}
