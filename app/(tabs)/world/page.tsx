import Link from "next/link";
import { requireProfile } from "@/lib/session";
import type { ConciergeAlert, WorldCity } from "@/lib/types";
import { dateRange, shortDate, todayISO } from "@/lib/format";
import { Avatar, PrimaryButton, ScreenTitle, Tag } from "@/components/ui";
import { FoFace } from "@/components/fo-face";
import { MarkWatchSeen } from "./concierge-watch";

const CHALK = ["#e9a3d2", "#9fd6c0", "#e6a8bd", "#a9c2ef", "#efa88c"];
const PETALS = [
  [2, "M31.4 17.2 C24.8 14.6 21.6 6.4 27.4 3.6 C30.4 2.2 32.2 4.2 32.6 6.4 C34.4 3.4 38.6 3.2 40.2 6.2 C42.4 10.4 37.6 15.4 32.4 17 Z"],
  [86, "M32.6 16.6 C26.2 15.4 21.8 7.8 26.6 4.2 C29.8 2.1 32 4.6 32.4 6.8 C33.8 3.8 38.2 3.4 39.6 6.8 C41.4 11.2 37.2 15.2 31.8 16.8 Z"],
  [171, "M31.6 17.4 C25.4 14.2 22.4 5.8 28.2 3.4 C31 2.4 32.4 4.8 32.8 7 C34.6 4.2 38.4 4 40 7.4 C41.8 11.6 37 15.8 32.2 17.2 Z"],
  [263, "M32.2 17 C25.6 15.2 21.4 7.2 26.8 3.8 C30 1.9 32.1 4.4 32.5 6.6 C34.2 3.6 38.8 3.6 40 7 C41.6 11.4 36.8 15.6 31.6 17.2 Z"],
] as const;

/** A friend's avatar inside a chalk-drawn flower, with their first name below. */
function FlowerAvatar({ person, col, turn, sub }: {
  person: { id: string; name: string; first_name: string; avatar_url: string | null; online?: boolean };
  col: string; turn: number; sub?: string;
}) {
  return (
    <Link href={`/people/${person.id}`} className="mx-auto flex w-full flex-col items-center">
      <div className="relative flex h-[68px] w-[68px] items-center justify-center">
        <svg width="68" height="68" viewBox="0 0 64 64" fill="none" className="pointer-events-none absolute inset-0 opacity-85 mix-blend-screen" aria-hidden>
          <g stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${turn % 72} 32 32)`}>
            {PETALS.map(([a, d]) => <path key={a} transform={`rotate(${a} 32 32)`} d={d} />)}
          </g>
        </svg>
        <Avatar id={person.id} name={person.name} src={person.avatar_url} size={42} online={person.online} ring="2.5px solid var(--color-well)" />
      </div>
      <div className="-mt-0.5 w-full truncate text-center font-display text-[17px] leading-none">{person.first_name}</div>
      {sub && <div className="mt-0.5 w-full truncate text-center text-[12px] text-muted">{sub}</div>}
    </Link>
  );
}

function whenText(from: string, to: string) {
  if (from <= todayISO()) return `until ${shortDate(to)}`;
  return from === to ? `on ${shortDate(from)}` : dateRange(from, to);
}

/** One heading per city and kind of overlap, e.g. "These friends will be in New York during your trip". */
function watchHeading(kind: ConciergeAlert["kind"], city: string, group: ConciergeAlert[]) {
  const now = group.every((a) => a.from <= todayISO());
  const who = group.length === 1 ? group[0].friend.first_name : "These friends";
  const be = group.length === 1 ? (now ? "is" : "will be") : (now ? "are" : "will be");
  if (kind === "visiting_you") return `${who} ${be} visiting ${city}`;
  if (kind === "both_away") return `${who} ${be} in ${city} too, during your trip`;
  return `${who} ${be} in ${city} during your trip`;
}

function names(list: string[]) {
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0];
}

function ConciergeWatch({ alerts }: { alerts: ConciergeAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-[18px] border-[1.5px] border-dashed border-[#3a352e] bg-[#141312] px-[15px] py-3.5">
        <div className="text-[13.2px] font-bold tracking-[.06em] text-faint uppercase">Fo Concierge watch</div>
        <div className="mt-1 text-[15px] leading-snug text-muted">
          Nothing to flag. Fo Concierge will tell you the moment someone you&apos;ve saved lands in a city you&apos;re in — or one you&apos;re headed to.
        </div>
      </div>
    );
  }
  const groups = new Map<string, ConciergeAlert[]>();
  for (const a of alerts) {
    const key = `${a.kind}|${a.city_id}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return (
    <div className="rounded-[18px] border-[1.5px] border-plum-line bg-plum px-[15px] py-3.5">
      <div className="text-[13.2px] font-bold tracking-[.06em] text-pink uppercase">Fo Concierge watch</div>
      <div className="mt-2.5 flex flex-col gap-4">
        {[...groups.values()].map((group, gi) => {
          const { kind, city, city_id } = group[0];
          // Friends seen once each, in case one shows up twice for the same city.
          const friends = group.filter((a, i) => group.findIndex((b) => b.friend.id === a.friend.id) === i);
          const sameDates = friends.every((a) => a.from === friends[0].from && a.to === friends[0].to);
          const when = sameDates ? whenText(friends[0].from, friends[0].to) : null;
          const draft = `Please organise catch-ups in ${city} with ${names(friends.map((a) => a.friend.first_name))}`
            + (kind === "visiting_you" ? " while they're visiting" : " during my trip")
            + (when ? ` (${when})` : "") + ".";
          return (
            <div key={`${kind}${city_id}`}>
              <div className="text-[17.4px] leading-snug">
                {watchHeading(kind, city, friends)}{when && <span className="text-muted"> · {when}</span>}
                {friends.some((a) => a.is_new) && <> <Tag tone="gold">New</Tag></>}
              </div>
              <div className="mt-[11px] grid grid-cols-4 gap-y-2.5">
                {friends.map((a, fi) => (
                  <FlowerAvatar key={a.friend.id} person={a.friend} col={CHALK[(gi * 2 + fi) % CHALK.length]} turn={fi * 17 + gi * 11}
                    sub={sameDates ? undefined : whenText(a.from, a.to)} />
                ))}
              </div>
              <Link href={`/fo?draft=${encodeURIComponent(draft)}`}
                className="mt-3 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-[14px] bg-ecru px-3 py-1.5 text-center font-display text-[18px] leading-tight text-ink transition-colors hover:bg-ecru-deep">
                <FoFace size={26} className="flex-none" /> Ask Fo to organise catch-ups with {friends.length === 1 ? friends[0].friend.first_name : "them"}?
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default async function WorldPage() {
  const { supabase } = await requireProfile();
  const [{ data }, { data: watch }] = await Promise.all([supabase.rpc("world"), supabase.rpc("concierge_watch")]);
  const cities = (data ?? []) as WorldCity[];
  const alerts = (watch ?? []) as ConciergeAlert[];

  return (
    <>
      <ScreenTitle right={
        <Link href="/connect#find" className="rounded-full bg-pink px-[13px] py-2 text-[15px] font-bold whitespace-nowrap text-ink">+ Add friend</Link>
      }>
        Who&apos;s where
      </ScreenTitle>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-2.5 pb-3.5">
        {alerts.length > 0 && <ConciergeWatch alerts={alerts} />}
        <MarkWatchSeen hasNew={alerts.some((a) => a.is_new)} />
        {cities.length === 0 && (
          <div className="rounded-[18px] border-[1.5px] border-plum-line bg-plum p-[15px]">
            <div className="text-[17.4px] font-semibold">No saved friends yet</div>
            <p className="mt-1 text-[15px] leading-snug text-plum-text">
              Tap <b>Add friend</b> on someone&apos;s profile or in a chat. Once they accept, you&apos;ll see where in the world they are here.
            </p>
            <PrimaryButton href="/connect" className="mt-3 !h-[46px] !text-[20px]">find your friends</PrimaryButton>
          </div>
        )}
        {cities.map((c, ci) => {
          const meta = c.my_trip ? `your trip · ${dateRange(c.my_trip.starts_on, c.my_trip.ends_on)}`
            : [c.based && `${c.based} based here`, c.visiting && `${c.visiting} visiting`, c.upcoming && `${c.upcoming} heading there`].filter(Boolean).join(" · ");
          const visitor = c.people.find((p) => p.presence === "visiting");
          const upcoming = c.people.find((p) => p.presence === "upcoming");
          const note = visitor ? `${visitor.first_name} is in ${c.city} until ${shortDate(visitor.until)}.`
            : upcoming ? `${upcoming.first_name} arrives ${shortDate(upcoming.from)}.`
            : c.is_home ? "Your home city." : null;
          const cta = c.is_home ? { href: "/nearby", label: "See circle" }
            : c.my_trip ? { href: `/nearby?trip=${c.my_trip.id}`, label: "See circle" }
            : { href: `/trips?add=1&city=${c.city_id}`, label: "Plan a trip" };
          return (
            <div key={c.city_id} className="rounded-[18px] border-[1.5px] border-line bg-card px-[15px] py-3.5">
              <div className="flex items-baseline gap-2">
                <div className="min-w-0 flex-1 font-display text-[24px]">{c.city}</div>
                <div className="text-[13.8px] whitespace-nowrap text-muted">{meta}</div>
              </div>
              <div className="mt-[11px] grid grid-cols-4 gap-y-2.5">
                {c.people.map((p, fi) => (
                  <FlowerAvatar key={p.id + p.presence} person={p} col={CHALK[(ci * 2 + fi) % CHALK.length]} turn={fi * 17 + ci * 11} />
                ))}
              </div>
              <div className="mt-[11px] flex items-center gap-3">
                <div className="min-w-0 flex-1 text-[15px] leading-snug text-muted">{note}</div>
                <Link href={cta.href} className="rounded-full border-[1.5px] border-gold-line bg-gold-bg px-[13px] py-2 text-[14.4px] font-bold whitespace-nowrap text-gold">
                  {cta.label}
                </Link>
              </div>
            </div>
          );
        })}
        {alerts.length === 0 && <ConciergeWatch alerts={alerts} />}
      </div>
    </>
  );
}
