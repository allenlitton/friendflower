"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";

const EVERY_MS = 60_000;

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }));
}

function report(supabase: SupabaseClient, pos: GeolocationPosition) {
  return supabase.rpc("update_location", {
    p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy_m: pos.coords.accuracy,
  });
}

/**
 * While the app is open and live distance is on, sends your position about once a minute.
 * The server rounds it to ~100 m and only ever shows other people a distance.
 */
export function useLiveLocation(enabled: boolean, onSaved?: () => void) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const saved = useRef(onSaved);
  useEffect(() => { saved.current = onSaved; });
  useEffect(() => {
    if (!enabled || !("geolocation" in navigator)) return;
    let refreshed = false;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      currentPosition().then((pos) => report(supabase, pos)).then((res) => {
        if (res.data !== true) return;
        // Show live distances (and a city you've just arrived in) as soon as the first position lands.
        if (!refreshed) { refreshed = true; router.refresh(); }
        saved.current?.();
      }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, EVERY_MS);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", beat); };
  }, [enabled, supabase, router]);
}

/** Asks the browser for location, then turns live distance on. Returns an error message, or null. */
export async function turnOnLiveDistance(supabase: SupabaseClient, userId: string): Promise<string | null> {
  if (!("geolocation" in navigator)) return "This browser can't share your location.";
  let pos: GeolocationPosition;
  try {
    pos = await currentPosition();
  } catch (e) {
    return (e as GeolocationPositionError).code === 1
      ? "Location is blocked for Friend Flower. Allow it in your browser or phone settings, then try again."
      : "Couldn't find your location just now. Try again in a moment.";
  }
  const { error } = await supabase.from("profiles").update({ share_live_location: true, show_distance: true }).eq("id", userId);
  if (error) return error.message;
  await report(supabase, pos);
  return null;
}
