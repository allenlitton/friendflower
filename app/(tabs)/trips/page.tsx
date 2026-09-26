import { requireProfile } from "@/lib/session";
import type { City, FlightMatch, Neighbourhood, Trip } from "@/lib/types";
import { todayISO } from "@/lib/format";
import { TripsClient } from "./trips-client";

export default async function TripsPage({ searchParams }: PageProps<"/trips">) {
  const { supabase, profile } = await requireProfile();
  const sp = await searchParams;
  const [trips, matches, cities, nbs] = await Promise.all([
    supabase.from("trips").select("id, city_id, neighbourhood_id, starts_on, ends_on, visibility, trip_flights(id, direction, flight_no, flight_date)")
      .eq("user_id", profile.id).gte("ends_on", todayISO()).order("starts_on"),
    supabase.rpc("flight_matches"),
    supabase.from("cities").select("id, name, short_name, country, is_launched").order("name"),
    supabase.from("neighbourhoods").select("id, city_id, name").order("name"),
  ]);
  return (
    <TripsClient
      trips={(trips.data ?? []) as Trip[]}
      matches={(matches.data ?? []) as FlightMatch[]}
      cities={(cities.data ?? []) as City[]}
      neighbourhoods={(nbs.data ?? []) as Neighbourhood[]}
      homeCity={profile.home_city_id}
      openAdd={sp.add === "1"}
      presetCity={typeof sp.city === "string" ? sp.city : undefined}
      userId={profile.id}
    />
  );
}
