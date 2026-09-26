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
