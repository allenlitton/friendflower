"use client";

import { useEffect, useState } from "react";
import type { City, CityOption } from "@/lib/types";
import { Pill } from "@/components/ui";

/**
 * Pick any city in the world. The live-map cities are one tap away; everything
 * else is a search (our cities plus the geocoder), and a city we don't have yet
 * is added when it's picked.
 */
export function CityPicker({ value, cities, onChange }: {
  value: string;
  cities: City[];
  onChange: (city: { id: string; name: string; launched: boolean }) => void;
}) {
  const current = cities.find((c) => c.id === value);
  const [label, setLabel] = useState(current ? cityLabel(current) : "");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CityOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const launched = cities.filter((c) => c.is_launched);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/cities?${new URLSearchParams({ q: term })}`, { signal: ctl.signal });
        const json = await res.json();
        setResults(json.results ?? []);
        setError(res.ok ? "" : json.error);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Couldn't search right now. Try again.");
      } finally {
        if (!ctl.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  function pick(c: { id: string; name: string; launched: boolean }, text: string) {
    setLabel(text);
    setQ("");
    setResults([]);
    onChange(c);
  }

  async function choose(o: CityOption) {
    const text = [o.name, o.detail].filter(Boolean).join(", ");
    if (o.id) return pick({ id: o.id, name: o.name, launched: o.launched }, text);
    setAdding(true);
    setError("");
    const res = await fetch("/api/cities", { method: "POST", body: JSON.stringify({ geonameId: o.geonameId }) });
    const json = await res.json();
    setAdding(false);
    if (!res.ok) return setError(json.error);
    pick({ id: json.id, name: json.name, launched: json.launched }, text);
  }

  const term = q.trim();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-[7px]">
        {launched.map((c) => (
          <Pill key={c.id} on={value === c.id} onClick={() => pick({ id: c.id, name: c.name, launched: true }, cityLabel(c))}>{c.name}</Pill>
        ))}
      </div>
      {value && !launched.some((c) => c.id === value) && label && (
        <div className="rounded-xl border-[1.5px] border-pink bg-card px-3.5 py-2.5 text-[14px] font-semibold">📍 {label}</div>
      )}
      <input className="field" type="search" autoComplete="off" placeholder={value ? "Somewhere else? Search any city" : "Search any city in the world"}
        value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} />
      {term.length >= 2 && (
        <div className="overflow-hidden rounded-xl border-[1.5px] border-line bg-card">
          {results.map((o) => (
            <button key={o.id ?? `g${o.geonameId}`} type="button" disabled={adding} onClick={() => choose(o)}
              className="flex w-full items-baseline gap-2 border-b border-line-soft px-3.5 py-2.5 text-left last:border-b-0 hover:bg-well disabled:opacity-60">
              <span className="text-[14px] font-semibold">{o.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{o.detail}</span>
              {o.launched && <span className="text-[10.5px] font-bold text-pink">live map</span>}
            </button>
          ))}
          {!results.length && (
            <div className="px-3.5 py-2.5 text-[12.5px] text-muted">{searching ? "Searching…" : "No cities found. Try another spelling."}</div>
          )}
        </div>
      )}
      {adding && <div className="text-[12px] text-muted">Adding city…</div>}
      {error && <div className="text-[12px] text-plum-text">{error}</div>}
    </div>
  );
}

function cityLabel(c: City) {
  return [c.name, c.region, c.country].filter(Boolean).join(", ");
}
