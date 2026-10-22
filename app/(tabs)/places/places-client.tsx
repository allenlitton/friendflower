"use client";

import Link from "next/link";
import { Capacitor } from "@capacitor/core";
import { useState } from "react";
import type { ChatSummary, Neighbourhood, Venue } from "@/lib/types";
import { Avatar, ErrorNote, Pill, PrimaryButton, ScreenTitle, SectionLabel } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { useRpc } from "@/components/person-actions";
import { AskFoButton } from "@/components/fo-concierge";

const FILTERS = [
  { label: "All", kinds: null },
  { label: "Coffee", kinds: ["coffee"] },
  { label: "Dinner", kinds: ["restaurant"] },
  { label: "Drinks", kinds: ["bar"] },
  { label: "Museums", kinds: ["museum"] },
  { label: "Free", kinds: ["outdoors", "movement"] },
];
const KIND_LABEL: Record<Venue["kind"], string> = {
  coffee: "Coffee", restaurant: "Restaurant", bar: "Wine bar", outdoors: "Free · outdoors", movement: "Movement", museum: "Museum · exhibit",
};
const KIND_GRAD: Record<Venue["kind"], string> = {
  coffee: "linear-gradient(135deg,#cbb79a,#9d8460)", restaurant: "linear-gradient(135deg,#e0c8a8,#bb9a72)",
  bar: "linear-gradient(135deg,#c99aa6,#95677a)", outdoors: "linear-gradient(135deg,#a9c093,#77955f)",
  movement: "linear-gradient(135deg,#a8bcc0,#75919a)",
  museum: "linear-gradient(135deg,#bcb0cc,#8a7ba3)",
};

// Searched by name rather than lat/lng: places people add only carry their neighbourhood's centre point.
function mapsQuery(v: Venue, cityName: string) {
  return encodeURIComponent([v.name, v.neighbourhood?.replace(/^the /i, ""), cityName].filter(Boolean).join(", "));
}
const googleMapsUrl = (v: Venue, cityName: string) => `https://www.google.com/maps/search/?api=1&query=${mapsQuery(v, cityName)}`;
const appleMapsUrl = (v: Venue, cityName: string) => `https://maps.apple.com/?q=${mapsQuery(v, cityName)}`;

/** The iPhone app, or Safari on an iPhone/iPad (iPadOS reports itself as a Mac with touch). */
function isIOS() {
  if (Capacitor.getPlatform() === "ios") return true;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

const KINDS: { value: Venue["kind"]; label: string }[] = [
  { value: "coffee", label: "Coffee" }, { value: "restaurant", label: "Restaurant" }, { value: "bar", label: "Bar" },
  { value: "outdoors", label: "Outdoors" }, { value: "movement", label: "Movement" },
  { value: "museum", label: "Museum / exhibit" },
];

export function PlacesClient({ city, cities, venues, neighbourhoods, chats }: {
  city: { id: string; name: string; short_name: string }; cities: { id: string; name: string; short_name: string }[];
  venues: Venue[]; neighbourhoods: Neighbourhood[]; chats: ChatSummary[];
}) {
  const { supabase, router, call, busy, error } = useRpc();
  const [filter, setFilter] = useState("All");
  const [suggest, setSuggest] = useState<Venue | null>(null);
  const [mapsFor, setMapsFor] = useState<Venue | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "coffee" as Venue["kind"], nb: "", note: "" });

  async function addPlace() {
    const id = await call<string>("add_place", {
      p_city: city.id, p_neighbourhood: draft.nb, p_name: draft.name, p_kind: draft.kind, p_note: draft.note,
    });
    if (id) {
      setAdding(false);
      setDraft({ name: "", kind: "coffee", nb: "", note: "" });
      router.refresh();
    }
  }
  const kinds = FILTERS.find((f) => f.label === filter)?.kinds;
  const shown = venues.filter((v) => !kinds || kinds.includes(v.kind));

  async function toggleGo(v: Venue) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (v.i_go) await supabase.from("venue_regulars").delete().eq("venue_id", v.id).eq("user_id", user.id);
    else await supabase.from("venue_regulars").insert({ venue_id: v.id, user_id: user.id });
    router.refresh();
  }

  async function sendTo(chatId: string) {
    if (!suggest) return;
    await call("send_message", { p_chat: chatId, p_body: `How about ${suggest.name}?`, p_venue: suggest.id });
    router.push(`/chat/${chatId}`);
  }

  return (
    <>
      <ScreenTitle right={neighbourhoods.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-full bg-pink px-[13px] py-2 text-[15px] font-bold whitespace-nowrap text-ink">+ Add a place</button>
        )}>Places to meet</ScreenTitle>
      {cities.length > 1 && (
        <div className="flex flex-none gap-2 px-5 pt-1.5">
          {cities.map((c) => (
            <Link key={c.id} href={`/places?city=${c.id}`}
              className={`text-[14.4px] font-bold ${c.id === city.id ? "text-pink" : "text-faint"}`}>{c.name}</Link>
          ))}
        </div>
      )}
      <div className="flex flex-none gap-[7px] overflow-x-auto px-5 pt-[11px] pb-[9px]">
        {FILTERS.map((f) => <Pill key={f.label} on={filter === f.label} onClick={() => setFilter(f.label)}>{f.label}</Pill>)}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-5 pb-3.5">
        {venues.length === 0 && (
          <div className="rounded-[18px] border-[1.5px] border-dashed border-[#3a352e] bg-[#141312] px-[15px] py-3.5 text-[15.6px] leading-normal text-muted">
            We&apos;re still hand-picking places in {city.name}. In the meantime, ask your circle where they&apos;d take you.
          </div>
        )}
        {shown.map((v) => {
          const names = v.regulars.map((r) => r.first_name);
          const vouch = v.i_go && names.length === 0 ? "You go here"
            : names.length === 0 ? "No one in your circle yet"
            : names.length === 1 ? `${names[0]} goes here`
            : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} go here`;
          return (
            <div key={v.id} className="flex flex-col rounded-[18px] border-[1.5px] border-line bg-card">
              <div className="flex h-[88px] flex-none items-end justify-between gap-2 rounded-t-2xl px-[13px] py-2.5" style={{ background: KIND_GRAD[v.kind] }}>
                <span className="rounded-full bg-white/95 px-2.5 py-1 text-[13.2px] font-bold text-[#6b645b]">{KIND_LABEL[v.kind]}</span>
                <a href={googleMapsUrl(v, city.name)} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => { if (isIOS()) { e.preventDefault(); setMapsFor(v); } }}
                  className="rounded-full bg-white/95 px-2.5 py-1 text-[13.2px] font-bold whitespace-nowrap text-[#6b645b]">Open in Maps ↗</a>
              </div>
              <div className="px-[15px] pt-[13px] pb-3.5">
                <div className="flex items-baseline gap-2">
                  <div className="min-w-0 flex-1 font-display text-[23px]">{v.name}</div>
                  <div className="text-[13.8px] whitespace-nowrap text-muted">
                    {v.walk_min != null ? (v.walk_min <= 45 ? `${Math.max(2, v.walk_min)} min walk` : v.neighbourhood) : v.neighbourhood}
                  </div>
                </div>
                {v.note && <div className="mt-1 text-[15.6px] leading-snug text-muted">{v.note}</div>}
                {v.added_by && (
                  <div className="mt-1.5 flex items-center gap-2 text-[13.8px] text-faint">
                    <span>{v.mine ? "Added by you" : `Added by ${v.added_by.name}`}{v.neighbourhood ? ` · ${v.neighbourhood}` : ""}</span>
                    {v.mine && (
                      <button type="button" className="font-semibold text-pink" onClick={async () => {
                        if (confirm(`Remove ${v.name}? Your circle won't see it any more.`)) { await call("remove_place", { p_id: v.id }); router.refresh(); }
                      }}>Remove</button>
                    )}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex">
                    {v.regulars.slice(0, 3).map((r) => (
                      <div key={r.id} className="-mr-2"><Avatar id={r.id} name={r.name} src={r.avatar_url} size={26} ring="2px solid #fff" /></div>
                    ))}
                  </div>
                  <span className={`min-w-0 flex-1 text-[13.8px] text-muted ${v.regulars.length ? "ml-3" : ""}`}>{vouch}</span>
                  <button type="button" onClick={() => toggleGo(v)}
                    className={`rounded-full px-3 py-2 text-[14.4px] font-bold whitespace-nowrap ${v.i_go ? "bg-leaf-bg text-leaf" : "bg-[#262220] text-soft"}`}>
                    {v.i_go ? "✓ I go here" : "I go here"}
                  </button>
                  <button type="button" onClick={() => setSuggest(v)}
                    className="rounded-full bg-pink px-3.5 py-1.5 font-display text-[16px] whitespace-nowrap text-ink">Suggest</button>
                </div>
              </div>
            </div>
          );
        })}
        <div className="mt-1">
          <AskFoButton />
          <div className="mt-2 text-center text-[13.8px] leading-snug text-faint">Fo Concierge finds a spot and books the table. Hospitality partner perks are coming soon.</div>
        </div>
      </div>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add a place">
        <p className="mt-1.5 text-[15.6px] leading-normal text-muted">
          Somewhere you&apos;d take a new friend in {city.name}. Your friends and friends of friends will see it here.
        </p>
        <SectionLabel className="mt-3.5">Name</SectionLabel>
        <input className="field" placeholder="e.g. Blue Bottle, Hayes Valley" maxLength={80} value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <SectionLabel className="mt-3.5">What kind of place</SectionLabel>
        <div className="flex flex-wrap gap-[7px]">
          {KINDS.map((k) => <Pill key={k.value} on={draft.kind === k.value} onClick={() => setDraft({ ...draft, kind: k.value })}>{k.label}</Pill>)}
        </div>
        <SectionLabel className="mt-3.5">Neighbourhood</SectionLabel>
        <select className="field" value={draft.nb} onChange={(e) => setDraft({ ...draft, nb: e.target.value })}>
          <option value="">Where is it?</option>
          {neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
        <SectionLabel className="mt-3.5">Why you like it (optional)</SectionLabel>
        <textarea className="field !min-h-[70px] !text-[14px]" maxLength={280} placeholder="Best seats, what to order, when to go…"
          value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton className="mt-4" disabled={busy || !draft.name.trim() || !draft.nb} onClick={addPlace}>add place</PrimaryButton>
      </Sheet>

      <Sheet open={!!suggest} onClose={() => setSuggest(null)} title={`Suggest ${suggest?.name ?? ""}`}>
        <div className="mt-3 flex flex-col gap-1.5">
          {chats.length === 0 && <div className="text-[15.6px] text-muted">Start a chat with someone first, then suggest a place.</div>}
          {chats.map((c) => (
            <button key={c.id} type="button" onClick={() => sendTo(c.id)}
              className="flex items-center gap-2.5 rounded-xl border-[1.5px] border-line bg-card px-3 py-2 text-left">
              {c.members[0] && <Avatar id={c.members[0].id} name={c.members[0].name} src={c.members[0].avatar_url} size={32} />}
              <span className="text-[16.8px] font-semibold">{c.members.map((m) => m.first_name).join(" · ")}</span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!mapsFor} onClose={() => setMapsFor(null)} title="Open in">
        {mapsFor && (
          <div className="mt-3 flex flex-col gap-1.5">
            {[{ label: "Apple Maps", href: appleMapsUrl(mapsFor, city.name) }, { label: "Google Maps", href: googleMapsUrl(mapsFor, city.name) }].map((o) => (
              <a key={o.label} href={o.href} target="_blank" rel="noopener noreferrer" onClick={() => setMapsFor(null)}
                className="flex h-[46px] items-center justify-center rounded-[13px] border-[1.5px] border-line bg-card text-[16.8px] font-semibold text-soft">{o.label}</a>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}
