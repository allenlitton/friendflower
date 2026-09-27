import Link from "next/link";
import { requireProfile } from "@/lib/session";
import { currentLens, myLenses } from "@/lib/whereabouts";
import type { CirclePerson } from "@/lib/types";
import { dateRange, todayISO } from "@/lib/format";
import { NearbyGrid } from "./nearby-grid";
import { PrimaryButton } from "@/components/ui";

export default async function NearbyPage({ searchParams }: PageProps<"/nearby">) {
  const { supabase, profile } = await requireProfile();
  const sp = await searchParams;
  const lenses = await myLenses(supabase, profile);
  const lens = (sp.trip && lenses.find((l) => l.tripId === sp.trip)) || currentLens(lenses);

  if (!lens) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="font-display text-[30px]">Where are you based?</div>
        <p className="text-[13.5px] text-muted">Add the city you live in, or a trip, to see who you know there.</p>
        <PrimaryButton href="/you/edit">edit profile</PrimaryButton>
      </div>
    );
  }

  // The live map only runs in launched cities (San Francisco and New York for now).
  if (!lens.isLaunched) {
    const liveTrips = lenses.filter((l) => l.isLaunched && l.kind === "trip");
    return (
      <div className="flex flex-1 flex-col px-5 pt-2">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-[30px] leading-[1.1]">{lens.cityName}</h1>
        </div>
        <div className="mt-4 rounded-[18px] border-[1.5px] border-gold-line bg-gold-bg p-[15px]">
          <div className="text-[14.5px] font-semibold text-gold">The live map isn&apos;t in {lens.cityName} yet</div>
          <p className="mt-1.5 text-[13px] leading-normal text-body">
            For now it runs in San Francisco and New York. Your friends can still see you&apos;re in {lens.cityName} on their
            World page, and you can see where your friends are on yours.
          </p>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <PrimaryButton href="/world">see who&apos;s where</PrimaryButton>
          {liveTrips.map((t) => (
            <Link key={t.tripId} href={`/nearby?trip=${t.tripId}`}
              className="rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-3 text-[14px] font-semibold">
              ✈ Your {t.cityName} trip · {dateRange(t.from, t.to)} <span className="float-right text-pink">›</span>
            </Link>
          ))}
          <Link href="/trips?add=1" className="rounded-2xl border-[1.5px] border-dashed border-[#3a352e] px-3.5 py-3 text-center text-[13px] font-semibold text-pink">
            + Add a trip to San Francisco or New York
          </Link>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase.rpc("circle_in_city", { p_city: lens.cityId, p_from: lens.from, p_to: lens.to });
  const people = (data ?? []) as CirclePerson[];
  const isNow = lens.from <= todayISO() && lens.to >= todayISO();

  return (
    <NearbyGrid
      people={people}
      error={error?.message}
      me={{ id: profile.id, name: profile.first_name, avatar: profile.avatar_url }}
      lens={lens}
      lenses={lenses}
      needsNeighbourhood={lens.kind === "home" && !profile.home_neighbourhood_id}
      offerLive={isNow && profile.show_distance && !profile.share_live_location}
      subtitle={isNow ? (lens.kind === "home" ? "Your circle here right now" : `You're here until ${dateRange(lens.from, lens.to).split(" – ")[1]}`) : `Your trip · ${dateRange(lens.from, lens.to)}`}
      footer={
        <Link href={`/places?city=${lens.cityId}`}
          className="mt-2.5 flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-[13px] hover:border-[#5a534b]">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-[#2b2118] text-[15px]">☕</span>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">Where to meet in {lens.short}</div>
            <div className="text-[11.5px] text-muted">Places your circle actually goes</div>
          </div>
          <span className="text-[17px] text-pink">›</span>
        </Link>
      }
    />
  );
}
