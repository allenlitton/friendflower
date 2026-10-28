import { requireProfile } from "@/lib/session";
import { currentLens, myLenses } from "@/lib/whereabouts";
import type { ChatSummary, Neighbourhood, Venue } from "@/lib/types";
import { PlacesClient } from "./places-client";

export default async function PlacesPage({ searchParams }: PageProps<"/places">) {
  const { supabase, profile } = await requireProfile();
  const sp = await searchParams;
  const lenses = await myLenses(supabase, profile);
  // Places opens in more cities than the live map does (has_places vs is_launched).
  const { data: launched } = await supabase.from("cities").select("id, name, short_name").eq("has_places", true).order("name");
  const cityId = (typeof sp.city === "string" && sp.city) || currentLens(lenses)?.cityId || launched?.[0]?.id || "san-francisco";

  const [{ data: venues }, { data: chats }, { data: nbs }] = await Promise.all([
    supabase.rpc("venues_in", { p_city: cityId }),
    supabase.rpc("my_chats"),
    supabase.from("neighbourhoods").select("id, city_id, name").eq("city_id", cityId).order("name"),
  ]);
  const city = launched?.find((c) => c.id === cityId) ?? { id: cityId, name: lenses.find((l) => l.cityId === cityId)?.cityName ?? cityId, short_name: "" };

  return (
    <PlacesClient
      city={city}
      cities={launched ?? []}
      venues={(venues ?? []) as Venue[]}
      neighbourhoods={(nbs ?? []) as Neighbourhood[]}
      chats={((chats ?? []) as ChatSummary[]).filter((c) => !c.left)}
    />
  );
}
