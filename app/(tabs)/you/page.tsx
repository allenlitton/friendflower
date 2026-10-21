import { requireProfile } from "@/lib/session";
import { getPlan } from "@/lib/plan";
import type { Mini } from "@/lib/types";
import { shortDate, todayISO } from "@/lib/format";
import { YouClient } from "./you-client";

export default async function YouPage() {
  const { supabase, profile } = await requireProfile();
  const [{ data: city }, { data: trips }, { data: blocks }, { data: stats }, plan] = await Promise.all([
    supabase.from("cities").select("name").eq("id", profile.home_city_id ?? "").maybeSingle(),
    supabase.from("trips").select("starts_on, ends_on, from_live, live_asked, cities(name)").eq("user_id", profile.id)
      .gte("ends_on", todayISO()).order("starts_on").limit(3),
    supabase.rpc("my_blocks"),
    supabase.rpc("my_contact_stats"),
    getPlan(),
  ]);
  type T = { starts_on: string; ends_on: string; from_live: boolean; live_asked: boolean; cities: { name: string } };
  const today = todayISO();
  const all = (trips ?? []) as unknown as T[];
  // Where you are now: a trip covering today (a live one first), else home.
  const current = all.filter((t) => t.starts_on <= today).sort((a, b) => Number(b.from_live) - Number(a.from_live))[0];
  const next = all.find((t) => t.starts_on > today);
  // A live trip whose dates you haven't set yet has no real end date to show.
  const open = current && current.from_live && !current.live_asked && current.ends_on === today;
  const here = current
    ? `${current.cities.name} ${open ? "now" : `until ${shortDate(current.ends_on)}`}`
    : `${city?.name ?? "Somewhere"} now`;
  const sub = `${here}${next ? ` · ${next.cities.name} ${shortDate(next.starts_on)}` : ""}`;

  return <YouClient profile={profile} sub={sub} blocks={(blocks ?? []) as Mini[]} contactMatches={stats?.matches ?? 0} blossom={plan.isBlossom} />;
}
