"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { CirclePerson } from "@/lib/types";
import type { Lens } from "@/lib/whereabouts";
import { dateRange, degreeWord, gradientFor, initials, nearbyLabel, shortDate } from "@/lib/format";
import { Flower, Pill, PrimaryButton } from "@/components/ui";
import { Sheet } from "@/components/sheet";

const FILTERS = ["Nearby", "Online", "1st degree", "2nd degree", "Travellers"] as const;
const EXTRAS = ["Saved friends", "Verified", "Same school", "Leaving soon"] as const;

export function NearbyGrid({ people, error, me, lens, lenses, subtitle, footer }: {
  people: CirclePerson[]; error?: string; me: { id: string; name: string; avatar: string | null };
  lens: Lens; lenses: Lens[]; subtitle: string; footer: ReactNode;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Nearby");
  const [extras, setExtras] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [travelOpen, setTravelOpen] = useState(false);

  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  const soonISO = soon.toISOString().slice(0, 10);
  const shown = people
    .filter((p) => filter === "Nearby" || (filter === "Online" ? p.online : filter === "1st degree" ? p.degree === 1
      : filter === "2nd degree" ? p.degree === 2 : p.presence === "visiting"))
    .filter((p) => extras.every((x) =>
      x === "Saved friends" ? p.is_friend : x === "Verified" ? p.verified : x === "Same school" ? p.via_kind === "school"
        : p.presence === "visiting" && !!p.ends_on && p.ends_on <= soonISO));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 px-5 pt-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[30px] leading-[1.1]">{lens.cityName}</h1>
            <Flower />
          </div>
          <div className="text-[11.5px] text-muted">{subtitle}</div>
        </div>
        <button type="button" onClick={() => setTravelOpen(true)}
          className="rounded-full border-[1.5px] border-line bg-card px-3 py-2 text-[12px] font-semibold whitespace-nowrap text-soft hover:border-[#5a534b]">
          ✈ Travelling
        </button>
      </div>


      <div className="flex flex-none gap-[7px] overflow-x-auto px-5 pt-[11px] pb-[9px]">
        {FILTERS.map((f) => <Pill key={f} on={filter === f} onClick={() => setFilter(f)}>{f}</Pill>)}
        <Pill on={moreOpen || extras.length > 0} onClick={() => setMoreOpen(!moreOpen)}>
          {extras.length ? `Filters · ${extras.length}` : "Filters"} <span className="text-[9px] opacity-80">▾</span>
        </Pill>
      </div>
      {moreOpen && (
        <div className="mx-5 mb-2.5 rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-[13px]">
          <div className="text-[11px] font-bold tracking-[.06em] text-muted uppercase">More filters</div>
          <div className="mt-[11px] flex flex-wrap gap-[7px]">
            {EXTRAS.map((x) => (
              <Pill key={x} on={extras.includes(x)} onClick={() => setExtras(extras.includes(x) ? extras.filter((e) => e !== x) : [...extras, x])}>{x}</Pill>
            ))}
          </div>
          <button type="button" onClick={() => setExtras([])} className="mt-[11px] text-[12px] font-semibold text-pink">
            {extras.length ? `Clear ${extras.length} filter${extras.length > 1 ? "s" : ""}` : "Pick any that apply"}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3">
        {error && <div className="mb-3 text-[12.5px] text-plum-text">{error}</div>}
        <div className="grid grid-cols-3 gap-[9px]">
          <Link href={`/people/${me.id}`} className="relative aspect-[0.61] overflow-hidden rounded-2xl shadow-[inset_0_0_0_2.5px_var(--color-pink)]"
            style={{ background: gradientFor(me.id) }}>
            <TileImage src={me.avatar} name={me.name} />
            <span className="absolute top-1.5 right-1.5 rounded-full bg-pink px-[7px] py-[3px] text-[9.5px] font-bold text-ink">Edit</span>
            <TileFooter name="You" tag={lens.kind === "home" ? "Living here" : "Visiting"} tagColor="#8a3a57" />
          </Link>
          {shown.map((p) => (
            <Link key={p.uid} href={`/people/${p.uid}`} className="relative aspect-[0.61] overflow-hidden rounded-2xl"
              style={{ background: gradientFor(p.uid) }}>
              <TileImage src={p.avatar_url} name={p.name} />
              {p.degree === 1 && (
                <Flower size={19} stroke="#fff" strokeWidth={4.2} className="absolute top-1.5 left-1.5 drop-shadow" />
              )}
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
                {p.online && <span className="h-[9px] w-[9px] rounded-full border-2 border-white/90 bg-online" />}
                <span className="rounded-full bg-[rgba(28,23,19,.5)] px-1.5 py-[3px] text-[9.5px] font-bold text-white">
                  {degreeWord(p.degree)}{p.verified ? " ✓" : ""}
                </span>
              </div>
              <TileFooter name={p.first_name}
                tag={p.presence === "visiting" ? `Until ${shortDate(p.ends_on)}` : "Local"}
                tagColor={p.presence === "visiting" ? "#8a5418" : "#2f6b4c"}
                dist={nearbyLabel(p.distance_mi)} />
            </Link>
          ))}
        </div>

        {people.length === 0 && !error && (
          <div className="mt-3 rounded-2xl border-[1.5px] border-plum-line bg-plum p-[15px]">
            <div className="text-[14.5px] font-semibold">Your flower is still a bud</div>
            <div className="mt-1 text-[12px] leading-snug text-plum-text">
              Nobody in your circle is in {lens.cityName} {lens.kind === "trip" ? "during your trip" : "right now"}. Sync your contacts or invite
              a few friends — their friends appear here too.
            </div>
            <PrimaryButton href="/connect" className="mt-3 !h-[46px] !text-[20px]">find your friends</PrimaryButton>
          </div>
        )}
        {people.length > 0 && shown.length === 0 && (
          <div className="py-6 text-center text-[12.5px] text-muted">No one matches those filters.</div>
        )}
        {footer}
      </div>

      <Sheet open={travelOpen} onClose={() => setTravelOpen(false)} title="Look ahead">
        <div className="mt-1.5 text-[13px] leading-normal text-muted">
          See a city&apos;s circle before you fly. Add a trip to look ahead at a new city.
        </div>
        <div className="mt-3.5 flex flex-col gap-2">
          {lenses.map((l) => {
            const active = l.cityId === lens.cityId && l.tripId === lens.tripId;
            return (
              <button key={l.tripId ?? "home"} type="button"
                onClick={() => { setTravelOpen(false); router.push(l.kind === "home" ? "/nearby" : `/nearby?trip=${l.tripId}`); }}
                className={`flex items-center gap-3 rounded-[15px] border-[1.5px] bg-card px-3.5 py-3 text-left ${active ? "border-pink" : "border-line"}`}>
                <span className="text-[15px]">{l.kind === "home" ? "📍" : "✈"}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold">{l.cityName}</div>
                  <div className="text-[11.5px] text-muted">{l.kind === "home" ? "Where you live" : dateRange(l.from, l.to)}</div>
                </div>
                {!l.isLaunched && <span className="rounded-full bg-gold-bg px-2 py-0.5 text-[10.5px] font-bold text-gold">no live map yet</span>}
              </button>
            );
          })}
          <Link href="/trips?add=1" className="rounded-[15px] border-[1.5px] border-dashed border-[#3a352e] px-3.5 py-3 text-center text-[13px] font-semibold text-pink">
            + Add a trip
          </Link>
        </div>
      </Sheet>
    </div>
  );
}

function TileImage({ src, name }: { src: string | null; name: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="absolute inset-0 h-full w-full bg-white object-cover" />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center pb-4 font-display text-[32px] text-white/90">{initials(name)}</div>
  );
}

function TileFooter({ name, tag, tagColor, dist }: { name: string; tag: string; tagColor: string; dist?: string | null }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-b from-transparent to-[rgba(24,19,15,.66)] px-2 pt-[18px] pb-[7px]">
      <div className="truncate text-[13px] leading-[1.1] font-semibold text-white">{name}</div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded-full bg-white/95 px-[5px] py-0.5 text-[9.5px] font-bold" style={{ color: tagColor }}>{tag}</span>
        {dist && <span className="text-[10px] text-white/90">{dist}</span>}
      </div>
    </div>
  );
}
