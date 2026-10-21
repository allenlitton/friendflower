"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { supabaseBrowser } from "@/lib/supabase/client";

const EVERY_MS = 60_000;

const OPTIONS = { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 };

/** In the iPhone app, location goes through iOS itself (one system prompt); older app builds and browsers use the web API. */
function isNativeLocation() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Geolocation");
}

function canLocate() {
  return isNativeLocation() || "geolocation" in navigator;
}

type Fix = { coords: { latitude: number; longitude: number; accuracy: number } };

class LocationDenied extends Error {}

async function currentPosition(): Promise<Fix> {
  if (isNativeLocation()) {
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location === "prompt" || perm.location === "prompt-with-rationale") perm = await Geolocation.requestPermissions();
      if (perm.location !== "granted" && perm.coarseLocation !== "granted") throw new LocationDenied();
      return await Geolocation.getCurrentPosition(OPTIONS);
    } catch (e) {
      if (e instanceof LocationDenied || /denied/i.test((e as Error).message ?? "")) throw new LocationDenied();
      throw e;
    }
  }
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, OPTIONS));
}

function report(supabase: SupabaseClient, pos: Fix) {
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
    if (!enabled || !canLocate()) return;
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
  if (!canLocate()) return "This browser can't share your location.";
  let pos: Fix;
  try {
    pos = await currentPosition();
  } catch (e) {
    return e instanceof LocationDenied || (e as GeolocationPositionError).code === 1
      ? "Location is blocked for Friend Flower. Allow it in your browser or phone settings, then try again."
      : "Couldn't find your location just now. Try again in a moment.";
  }
  const { error } = await supabase.from("profiles").update({ share_live_location: true, show_distance: true }).eq("id", userId);
  if (error) return error.message;
  await report(supabase, pos);
  return null;
}
