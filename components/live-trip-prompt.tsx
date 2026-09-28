"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { todayISO } from "@/lib/format";
import { useLiveLocation } from "@/components/live-location";
import { Sheet } from "@/components/sheet";
import { ErrorNote, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";

type LiveTrip = { id: string; city_id: string; city: string; starts_on: string; ends_on: string };

/**
 * Sends your position while live distance is on. When it lands you in a new city,
 * the server starts a trip there; this asks, once, whether you'd like to set its dates.
 */
export function LiveLocation({ enabled }: { enabled: boolean }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const [trip, setTrip] = useState<LiveTrip | null>(null);
  const [f, setF] = useState({ from: "", to: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const check = useCallback(() => {
    supabase.rpc("live_trip_to_confirm").then(({ data }) => {
      if (data) setTrip((cur) => (cur?.id === data.id ? cur : data));
    });
  }, [supabase]);

  useLiveLocation(enabled, check);
  useEffect(() => { if (enabled) check(); }, [enabled, check]);

  async function answer(dates: { starts_on: string; ends_on: string } | null) {
    if (!trip) return;
    setSaving(true);
    setError("");
    const { error } = await supabase.from("trips").update({ live_asked: true, ...dates }).eq("id", trip.id);
    setSaving(false);
    if (error) return setError(error.message);
    setTrip(null);
    setF({ from: "", to: "" });
    router.refresh();
  }

  const today = todayISO();
  const from = f.from || trip?.starts_on || today;
  const canSave = f.to && from <= today && f.to >= from && f.to >= today;

  return (
    <Sheet open={!!trip} onClose={() => answer(null)} title={trip ? `Visiting ${trip.city}?` : ""}>
      <div className="mt-1.5 text-[13px] leading-normal text-muted">
        Set your trip dates <span className="text-faint">(optional)</span>. Live distance already shows you&apos;re here, so friends in {trip?.city} can find you. Dates let them see how long you&apos;re around.
      </div>
      <SectionLabel className="mt-4">Dates</SectionLabel>
      <div className="grid grid-cols-2 gap-2.5">
        <input className="field" type="date" aria-label="Arrived" value={from} max={today}
          onChange={(e) => setF({ ...f, from: e.target.value })} />
        <input className="field" type="date" aria-label="Leaving" value={f.to} min={today}
          onChange={(e) => setF({ ...f, to: e.target.value })} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <PrimaryButton className="mt-4" disabled={!canSave || saving}
        onClick={() => answer({ starts_on: from, ends_on: f.to })}>{saving ? "saving…" : "save dates"}</PrimaryButton>
      <SecondaryButton className="mt-2" disabled={saving} onClick={() => answer(null)}>not now</SecondaryButton>
    </Sheet>
  );
}
