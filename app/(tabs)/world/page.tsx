import Link from "next/link";
import { requireProfile } from "@/lib/session";
import type { ConciergeAlert, WorldCity } from "@/lib/types";
import { dateRange, shortDate, todayISO } from "@/lib/format";
import { Avatar, PrimaryButton, ScreenTitle, Tag } from "@/components/ui";
import { MarkWatchSeen } from "./concierge-watch";

const CHALK = ["#e9a3d2", "#9fd6c0", "#e6a8bd", "#a9c2ef", "#efa88c"];
const PETALS = [
  [2, "M31.4 17.2 C24.8 14.6 21.6 6.4 27.4 3.6 C30.4 2.2 32.2 4.2 32.6 6.4 C34.4 3.4 38.6 3.2 40.2 6.2 C42.4 10.4 37.6 15.4 32.4 17 Z"],
  [86, "M32.6 16.6 C26.2 15.4 21.8 7.8 26.6 4.2 C29.8 2.1 32 4.6 32.4 6.8 C33.8 3.8 38.2 3.4 39.6 6.8 C41.4 11.2 37.2 15.2 31.8 16.8 Z"],
  [171, "M31.6 17.4 C25.4 14.2 22.4 5.8 28.2 3.4 C31 2.4 32.4 4.8 32.8 7 C34.6 4.2 38.4 4 40 7.4 C41.8 11.6 37 15.8 32.2 17.2 Z"],
  [263, "M32.2 17 C25.6 15.2 21.4 7.2 26.8 3.8 C30 1.9 32.1 4.4 32.5 6.6 C34.2 3.6 38.8 3.6 40 7 C41.6 11.4 36.8 15.6 31.6 17.2 Z"],
] as const;

function watchLine(a: ConciergeAlert) {
  const today = todayISO();
  const when = a.from <= today ? `until ${shortDate(a.to)}` : a.from === a.to ? `on ${shortDate(a.from)}` : dateRange(a.from, a.to);
  const first = a.friend.first_name;
  if (a.kind === "visiting_you") return `${first} ${a.from <= today ? "is" : "will be"} in ${a.city} ${when}.`;
  if (a.kind === "you_visiting") return `${first} lives in ${a.city}, where you ${a.from <= today ? "are" : "will be"} ${when}.`;
  return `You and ${first} ${a.from <= today ? "are both" : "will both be"} in ${a.city} ${when}.`;
}

function ConciergeWatch({ alerts }: { alerts: ConciergeAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-[18px] border-[1.5px] border-dashed border-[#3a352e] bg-[#141312] px-[15px] py-3.5">
        <div className="text-[11px] font-bold tracking-[.06em] text-faint uppercase">Concierge watch</div>
        <div className="mt-1 text-[12.5px] leading-snug text-muted">
          Nothing to flag. We&apos;ll tell you the moment someone you&apos;ve saved lands in a city you&apos;re in — or one you&apos;re headed to.
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-[18px] border-[1.5px] border-plum-line bg-plum px-[15px] py-3.5">
      <div className="text-[11px] font-bold tracking-[.06em] text-pink uppercase">Concierge watch</div>
      <div className="mt-2.5 flex flex-col gap-3">
        {alerts.map((a) => (
          <div key={`${a.friend.id}${a.city_id}${a.from}`} className="flex items-center gap-3">
            <Avatar id={a.friend.id} name={a.friend.name} src={a.friend.avatar_url} size={40} />
            <div className="min-w-0 flex-1 text-[13.5px] leading-snug">
              {watchLine(a)} {a.is_new && <Tag tone="gold">New</Tag>}
            </div>
            <Link href={`/people/${a.friend.id}`} className="rounded-full border-[1.5px] border-plum-line bg-card px-[13px] py-2 text-[12px] font-bold whitespace-nowrap text-pink">
              Say hi
            </Link>
          </div>
        ))}
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
        <Link href="/connect#find" className="rounded-full bg-pink px-[13px] py-2 text-[12.5px] font-bold whitespace-nowrap text-ink">+ Add friend</Link>
      }>
        Who&apos;s where
      </ScreenTitle>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-2.5 pb-3.5">
        {alerts.length > 0 && <ConciergeWatch alerts={alerts} />}
        <MarkWatchSeen hasNew={alerts.some((a) => a.is_new)} />
        {cities.length === 0 && (
          <div className="rounded-[18px] border-[1.5px] border-plum-line bg-plum p-[15px]">
            <div className="text-[14.5px] font-semibold">No saved friends yet</div>
            <p className="mt-1 text-[12.5px] leading-snug text-plum-text">
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
                <div className="text-[11.5px] whitespace-nowrap text-muted">{meta}</div>
              </div>
              <div className="mt-[11px] flex items-center">
                {c.people.slice(0, 5).map((p, fi) => {
                  const col = CHALK[(ci * 2 + fi) % CHALK.length];
                  return (
                    <Link key={p.id + p.presence} href={`/people/${p.id}`} className="relative -mr-3.5 flex h-[68px] w-[68px] flex-none items-center justify-center">
                      <svg width="68" height="68" viewBox="0 0 64 64" fill="none" className="pointer-events-none absolute inset-0 opacity-85 mix-blend-screen" aria-hidden>
                        <g stroke={col} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" transform={`rotate(${(fi * 17 + ci * 11) % 72} 32 32)`}>
                          {PETALS.map(([a, d]) => <path key={a} transform={`rotate(${a} 32 32)`} d={d} />)}
                        </g>
                      </svg>
                      <Avatar id={p.id} name={p.name} src={p.avatar_url} size={42} online={p.online} ring="2.5px solid var(--color-well)" />
                    </Link>
                  );
                })}
                {c.people.length > 5 && <span className="ml-5 text-[12px] text-muted">+{c.people.length - 5}</span>}
                <div className="flex-1" />
                <Link href={cta.href} className="z-10 rounded-full border-[1.5px] border-gold-line bg-gold-bg px-[13px] py-2 text-[12px] font-bold whitespace-nowrap text-gold">
                  {cta.label}
                </Link>
              </div>
              {note && <div className="mt-[11px] text-[12.5px] leading-snug text-muted">{note}</div>}
            </div>
          );
        })}
        {alerts.length === 0 && <ConciergeWatch alerts={alerts} />}
      </div>
    </>
  );
}
