import { requireProfile } from "@/lib/session";
import type { Mini } from "@/lib/types";
import { shortDate, todayISO } from "@/lib/format";
import { YouClient } from "./you-client";

export default async function YouPage() {
  const { supabase, profile } = await requireProfile();
  const [{ data: city }, { data: nextTrip }, { data: blocks }, { data: stats }] = await Promise.all([
    supabase.from("cities").select("name").eq("id", profile.home_city_id ?? "").maybeSingle(),
    supabase.from("trips").select("starts_on, cities(name)").eq("user_id", profile.id).gte("starts_on", todayISO()).order("starts_on").limit(1).maybeSingle(),
    supabase.rpc("my_blocks"),
    supabase.rpc("my_contact_stats"),
  ]);
  const trip = nextTrip as unknown as { starts_on: string; cities: { name: string } } | null;
  const sub = `${city?.name ?? "Somewhere"} now${trip ? ` · ${trip.cities.name} ${shortDate(trip.starts_on)}` : ""}`;

  return <YouClient profile={profile} sub={sub} blocks={(blocks ?? []) as Mini[]} contactMatches={stats?.matches ?? 0} />;
}
