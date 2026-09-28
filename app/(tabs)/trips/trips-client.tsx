"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { City, FlightMatch, Neighbourhood, Trip } from "@/lib/types";
import { dateRange, shortDate, todayISO } from "@/lib/format";
import { Avatar, ErrorNote, PrimaryButton, ScreenTitle, SectionLabel, Segmented } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { useRpc } from "@/components/person-actions";
import { CityPicker } from "@/components/city-picker";

const VIS = [
  { value: "first" as const, label: "1st only" },
  { value: "fof" as const, label: "Friends of friends" },
  { value: "nobody" as const, label: "Just me" },
];
const normFlight = (s: string) => s.toUpperCase().replace(/\s+/g, "");
const validFlight = (s: string) => /^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$/.test(s);

export function TripsClient({ trips, matches, cities, neighbourhoods, homeCity, openAdd, presetCity, userId }: {
  trips: Trip[]; matches: FlightMatch[]; cities: City[]; neighbourhoods: Neighbourhood[];
  homeCity: string | null; openAdd: boolean; presetCity?: string; userId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const { call } = useRpc();
  const [open, setOpen] = useState(openAdd);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cityLaunched, setCityLaunched] = useState(!!cities.find((c) => c.id === presetCity)?.is_launched);
  const [f, setF] = useState({
    city: presetCity ?? "", nb: "", from: "", to: "", vis: "fof" as Trip["visibility"], inNo: "", outNo: "", inDate: "", outDate: "",
  });
  const [edit, setEdit] = useState<{ id: string; city: string; from: string; to: string; started: boolean } | null>(null);
  const cityName = (id: string) => cities.find((c) => c.id === id)?.name ?? id;
  const homeShort = cities.find((c) => c.id === homeCity)?.short_name ?? "Home";
  const cityShort = (id: string) => cities.find((c) => c.id === id)?.short_name ?? "";
  const legCount = trips.reduce((n, t) => n + t.trip_flights.length, 0);
  const canSave = f.city && f.from && f.to && f.to >= f.from
    && (!f.inNo || validFlight(normFlight(f.inNo))) && (!f.outNo || validFlight(normFlight(f.outNo)));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    const { data: trip, error } = await supabase.from("trips")
      .insert({ user_id: userId, city_id: f.city, neighbourhood_id: f.nb || null, starts_on: f.from, ends_on: f.to, visibility: f.vis })
      .select("id").single();
    if (error) { setSaving(false); return setError(error.message); }
    const legs = [
      f.inNo && { trip_id: trip.id, user_id: userId, direction: "in", flight_no: normFlight(f.inNo), flight_date: f.inDate || f.from },
      f.outNo && { trip_id: trip.id, user_id: userId, direction: "out", flight_no: normFlight(f.outNo), flight_date: f.outDate || f.to },
    ].filter(Boolean);
    if (legs.length) {
      const { error } = await supabase.from("trip_flights").insert(legs);
      if (error) { setSaving(false); return setError(error.message); }
    }
    setSaving(false);
    setOpen(false);
    setF({ city: "", nb: "", from: "", to: "", vis: "fof", inNo: "", outNo: "", inDate: "", outDate: "" });
    router.replace("/trips");
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Remove this trip?")) return;
    await supabase.from("trips").delete().eq("id", id);
    router.refresh();
  }

  // Setting dates on a live trip also answers its "Visiting …?" question.
  async function saveDates() {
    if (!edit) return;
    setSaving(true);
    setError("");
    const { error } = await supabase.from("trips")
      .update({ starts_on: edit.from, ends_on: edit.to, live_asked: true }).eq("id", edit.id);
    setSaving(false);
    if (error) return setError(error.message);
    setEdit(null);
    router.refresh();
  }
  const today = todayISO();
  const canSaveDates = !!edit && !!edit.from && !!edit.to && edit.to >= edit.from && edit.to >= today
    && (edit.started ? edit.from <= today : edit.from >= today);

  async function setVisibility(id: string, vis: Trip["visibility"]) {
    await supabase.from("trips").update({ visibility: vis }).eq("id", id);
    router.refresh();
  }

  async function sayHi(m: FlightMatch) {
    const chat = await call<string>("open_direct_chat", { p_other: m.person.id });
    if (chat) {
      await call("send_message", { p_chat: chat, p_body: `Just saw we're both on ${m.flight_no} on ${shortDate(m.flight_date)} — small world!` });
      router.push(`/chat/${chat}`);
    }
  }

  return (
    <>
      <ScreenTitle right={<button type="button" onClick={() => setOpen(true)} className="rounded-full bg-pink px-[13px] py-2 text-[12.5px] font-bold text-ink">+ Add trip</button>}>
        Trips
      </ScreenTitle>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-2.5 pb-4">
        {trips.map((t) => {
          const now = t.starts_on <= todayISO();
          return (
            <div key={t.id} className="rounded-[18px] border-[1.5px] border-line bg-card px-[15px] py-3.5">
              <div className="flex items-baseline gap-2">
                <div className="min-w-0 flex-1 font-display text-[24px] leading-none">{cityName(t.city_id)}</div>
                <div className="text-[12px] whitespace-nowrap text-muted">{now ? `now · until ${shortDate(t.ends_on)}` : dateRange(t.starts_on, t.ends_on)}</div>
                <button type="button" aria-label="Remove trip" onClick={() => remove(t.id)} className="flex h-[22px] w-[22px] items-center justify-center text-[11px] text-faint">✕</button>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {t.from_live && <div className="min-w-0 flex-1 text-[11.5px] text-faint">📍 Started by live distance · ends when you leave</div>}
                <button type="button" onClick={() => { setError(""); setEdit({ id: t.id, city: cityName(t.city_id), from: t.starts_on, to: t.ends_on, started: now }); }}
                  className="ml-auto rounded-full border-[1.5px] border-line bg-well px-2.5 py-1 text-[11.5px] font-bold text-soft">Edit dates</button>
              </div>
              {t.trip_flights.sort((a, b) => a.direction.localeCompare(b.direction)).map((leg) => {
                const pax = matches.filter((m) => m.flight_id === leg.id);
                const from = leg.direction === "in" ? homeShort : cityShort(t.city_id);
                const to = leg.direction === "in" ? cityShort(t.city_id) : homeShort;
                return (
                  <div key={leg.id}>
                    <div className="mt-[11px] text-[11px] font-bold tracking-[.05em] text-pink uppercase">
                      {leg.direction === "in" ? `Inbound · to ${cityName(t.city_id)}` : `Outbound · from ${cityName(t.city_id)}`}
                    </div>
                    <div className="mt-1.5 rounded-[14px] border-[1.5px] border-dashed border-[#3a352e] bg-well px-[13px] py-3">
                      <div className="text-[11px] font-bold tracking-[.05em] text-muted uppercase">Flight {leg.flight_no} · {shortDate(leg.flight_date)}</div>
                      <div className="mt-2 flex items-center gap-2.5">
                        <div className="font-display text-[30px] leading-none tracking-[1px]">{from}</div>
                        <div className="flex flex-1 items-center gap-1.5">
                          <span className="h-0 flex-1 border-t-[1.5px] border-dashed border-[#4d4740]" /><span className="text-[13px] text-pink">✈</span><span className="h-0 flex-1 border-t-[1.5px] border-dashed border-[#4d4740]" />
                        </div>
                        <div className="font-display text-[30px] leading-none tracking-[1px]">{to}</div>
                      </div>
                    </div>
                    {pax.length > 0 ? (
                      <div className="mt-3">
                        <div className="mb-2 text-[12.5px] font-bold text-pink">{pax.length} from your circles on this flight</div>
                        {pax.map((m) => (
                          <div key={m.person.id} className="flex items-center gap-2.5 py-1">
                            <Link href={`/people/${m.person.id}`}><Avatar id={m.person.id} name={m.person.name} src={m.person.avatar_url} size={34} /></Link>
                            <Link href={`/people/${m.person.id}`} className="min-w-0 flex-1">
                              <div className="text-[13.5px] font-semibold">{m.person.name}</div>
                              <div className="text-[11px] text-muted">{m.person.degree === 1 ? "1st degree" : `2nd degree${m.person.via ? ` · via ${m.person.via}` : ""}`}</div>
                            </Link>
                            <button type="button" onClick={() => sayHi(m)} className="rounded-full border-[1.5px] border-plum-line bg-plum px-3 py-[7px] text-[12px] font-bold text-pink">Say hi</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-[11px] text-[12px] text-muted">No one in your circles has shared this flight yet.</div>
                    )}
                  </div>
                );
              })}
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[11px] font-bold tracking-[.05em] text-muted uppercase">Visible to</span>
                <select value={t.visibility} onChange={(e) => setVisibility(t.id, e.target.value as Trip["visibility"])}
                  className="rounded-lg border-[1.5px] border-line bg-well px-2 py-1 text-[12px] text-soft">
                  {VIS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <div className="flex-1" />
                <Link href={`/nearby?trip=${t.id}`} className="text-[12.5px] font-bold text-pink">See who&apos;s there ›</Link>
              </div>
            </div>
          );
        })}
        {trips.length === 0 && (
          <button type="button" onClick={() => setOpen(true)}
            className="rounded-2xl border-[1.5px] border-dashed border-[#3a352e] px-4 py-[22px] text-center text-[13px] leading-normal text-muted">
            Add an upcoming trip to see who you know there — and which friends and friends of friends are on your flight.
          </button>
        )}
        <div className="text-[11.5px] leading-normal text-faint">
          Flight matches only show people in your circles who&apos;ve added the same flight on the same day, and whose trip you&apos;re allowed to see.
          Seat numbers are never collected. {legCount === 0 && trips.length > 0 && "Add flight numbers to a trip to check for matches."}
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Add a trip">
        <SectionLabel className="mt-4">City</SectionLabel>
        <CityPicker value={f.city} cities={cities} exclude={homeCity} placeholder="Where are you going?"
          onChange={(c) => { setF({ ...f, city: c.id, nb: "" }); setCityLaunched(c.launched); }} />
        {f.city && !cityLaunched && (
          <div className="mt-1.5 text-[11.5px] leading-snug text-faint">
            No live map there yet. Friends will still see you&apos;re in this city on their World page.
          </div>
        )}
        {neighbourhoods.some((n) => n.city_id === f.city) && (
          <select className="field mt-2" value={f.nb} onChange={(e) => setF({ ...f, nb: e.target.value })}>
            <option value="">Staying in… (optional)</option>
            {neighbourhoods.filter((n) => n.city_id === f.city).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
        )}
        <SectionLabel className="mt-3.5">Dates</SectionLabel>
        <div className="grid grid-cols-2 gap-2.5">
          <input className="field" type="date" aria-label="Arriving" value={f.from} min={todayISO()} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to && f.to < e.target.value ? e.target.value : f.to })} />
          <input className="field" type="date" aria-label="Leaving" value={f.to} min={f.from || todayISO()} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <div>
            <SectionLabel>Inbound flight</SectionLabel>
            <input className="field" placeholder="e.g. UA 837" value={f.inNo} onChange={(e) => setF({ ...f, inNo: e.target.value })} />
            {f.inNo && <input className="field mt-1.5 !h-10 !text-[14px]" type="date" aria-label="Inbound flight date" value={f.inDate || f.from} onChange={(e) => setF({ ...f, inDate: e.target.value })} />}
          </div>
          <div>
            <SectionLabel>Outbound flight</SectionLabel>
            <input className="field" placeholder="e.g. UA 838" value={f.outNo} onChange={(e) => setF({ ...f, outNo: e.target.value })} />
            {f.outNo && <input className="field mt-1.5 !h-10 !text-[14px]" type="date" aria-label="Outbound flight date" value={f.outDate || f.to} onChange={(e) => setF({ ...f, outDate: e.target.value })} />}
          </div>
        </div>
        <div className="mt-1.5 text-[11px] text-faint">Flights are optional. We&apos;ll check whether anyone in your circles is on the same one.</div>
        <SectionLabel className="mt-3.5">Who can see this trip</SectionLabel>
        <Segmented value={f.vis} options={VIS} onChange={(vis) => setF({ ...f, vis })} />
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton className="mt-4" disabled={!canSave || saving} onClick={save}>{saving ? "saving…" : "add trip"}</PrimaryButton>
      </Sheet>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.city} dates` : ""}>
        <SectionLabel className="mt-4">Dates</SectionLabel>
        {edit && (
          <div className="grid grid-cols-2 gap-2.5">
            <input className="field" type="date" aria-label={edit.started ? "Arrived" : "Arriving"} value={edit.from}
              min={edit.started ? undefined : today} max={edit.started ? today : undefined}
              onChange={(e) => setEdit({ ...edit, from: e.target.value, to: edit.to < e.target.value ? e.target.value : edit.to })} />
            <input className="field" type="date" aria-label="Leaving" value={edit.to} min={edit.from > today ? edit.from : today}
              onChange={(e) => setEdit({ ...edit, to: e.target.value })} />
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton className="mt-4" disabled={!canSaveDates || saving} onClick={saveDates}>{saving ? "saving…" : "save dates"}</PrimaryButton>
      </Sheet>
    </>
  );
}
