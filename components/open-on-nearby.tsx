"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Opening the app always starts on Nearby. A cold start already lands there (the iPhone app
 * loads "/", which redirects, and the home-screen web app starts at /nearby), but iOS and
 * browsers often bring the app back on whatever screen it was left on. This sends people to
 * Nearby when they come back after a while, in the iPhone app and on the website alike.
 *
 * A quick switch away and back (under AWAY_MS) keeps your place. So does arriving somewhere
 * new on purpose, such as tapping a notification or an invite link: we only move you if you
 * would otherwise land on the very screen you left.
 */
const AWAY_MS = 30_000;
const KEY = "ff-left-at";
const HOME = "/nearby";

type Left = { path: string; at: number };

const here = () => window.location.pathname + window.location.search;

function remember() {
  try { localStorage.setItem(KEY, JSON.stringify({ path: here(), at: Date.now() } satisfies Left)); } catch {}
}

function takeLeft(): Left | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return raw ? (JSON.parse(raw) as Left) : null;
  } catch { return null; }
}

export function OpenOnNearby() {
  const router = useRouter();

  useEffect(() => {
    // Give a notification tap or link a moment to take you where it's going first.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const back = () => {
      const left = takeLeft();
      if (!left || Date.now() - left.at < AWAY_MS) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (here() === left.path && window.location.pathname !== HOME) router.replace(HOME);
      }, 400);
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? remember() : back());

    back(); // a fresh page load, e.g. iOS reloaded the app or the browser restored the tab
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", remember);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", remember);
    };
  }, [router]);

  return null;
}
