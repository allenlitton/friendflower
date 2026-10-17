"use client";

import { useState } from "react";
import type { Units } from "@/lib/types";
import { SectionLabel, Segmented } from "@/components/ui";
import { useRpc } from "@/components/person-actions";

// Only English for now; the rest are shown so people know they're coming.
const LANGUAGES = ["English", "Español", "Français", "Deutsch", "Português", "Italiano", "日本語", "中文", "한국어"];

export function SettingsClient({ profileId, units: initialUnits }: { profileId: string; units: Units }) {
  const { supabase, router } = useRpc();
  const [units, setUnits] = useState(initialUnits);

  async function changeUnits(u: Units) {
    setUnits(u);
    await supabase.from("profiles").update({ units: u }).eq("id", profileId);
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-[18px] pb-6">
      <div>
        <SectionLabel>Units</SectionLabel>
        <Segmented value={units} onChange={changeUnits}
          options={[{ value: "imperial", label: "Imperial (mi, ft)" }, { value: "metric", label: "Metric (km, m)" }]} />
        <div className="mt-2 text-[14.4px] leading-snug text-muted">Used for live distances on Nearby and profiles.</div>
      </div>

      <div>
        <SectionLabel>Language</SectionLabel>
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
          {LANGUAGES.map((l, i) => (
            <div key={l} className="flex items-center gap-[11px] border-b border-rule px-[15px] py-3 last:border-0">
              <span className={`flex-1 text-[16.8px] font-semibold ${i === 0 ? "" : "text-faint"}`}>{l}</span>
              {i === 0
                ? <span className="text-[18px] font-bold text-pink">✓</span>
                : <span className="rounded-full bg-gold-bg px-1.5 py-px text-[11.4px] font-bold text-gold">soon</span>}
            </div>
          ))}
        </div>
        <div className="mt-2 text-[14.4px] leading-snug text-muted">Friend Flower is English-only for now. More languages are on the way.</div>
      </div>
    </div>
  );
}
