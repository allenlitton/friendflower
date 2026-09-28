import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { City, Neighbourhood } from "@/lib/types";

/** Everything the profile editor needs. */
export async function loadEditorData(supabase: SupabaseClient, userId: string) {
  const [cities, nbs, places, schools, stats] = await Promise.all([
    supabase.from("cities").select("id, name, short_name, country, region, is_launched").order("name"),
    supabase.from("neighbourhoods").select("id, city_id, name").order("name"),
    supabase.from("user_places").select("id, city_name, years, kind").eq("user_id", userId).order("created_at"),
    supabase.from("user_schools").select("id, grad_year, level, schools(name)").eq("user_id", userId),
    supabase.rpc("my_contact_stats"),
  ]);
  return {
    cities: (cities.data ?? []) as City[],
    neighbourhoods: (nbs.data ?? []) as Neighbourhood[],
    places: places.data ?? [],
    schools: (schools.data ?? []) as never[],
    hasPhone: !!stats.data?.has_phone,
  };
}
