// Small display helpers shared by every screen.

import type { Units } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** '2026-10-03' -> 'Oct 3' (dates are calendar days, so no timezone maths). */
export function shortDate(iso: string | null | undefined) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** '2026-10-03' -> 'Sat Oct 3'. */
export function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()];
  return `${wd} ${MONTHS[m - 1]} ${d}`;
}

export function dateRange(from: string, to: string) {
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/**
 * Live distance between two people who both share their position. The database
 * gives miles to 0.1; short distances show in feet or metres.
 */
export function liveDistanceLabel(mi: number | null | undefined, units: Units = "imperial") {
  if (mi == null) return null;
  if (units === "metric") {
    const km = mi * 1.609344;
    return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
  }
  return mi < 0.1 ? `${Math.round(mi * 528) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

export function degreeWord(d: number) {
  return d === 1 ? "1st" : d === 2 ? "2nd" : "";
}

export function initials(name: string) {
  const parts = name.replace(/\./g, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "·";
}

const GRADS = [
  ["#c98da3", "#8c5f7d"], ["#7f9bb8", "#4d6a8a"], ["#c4a06a", "#96703c"], ["#b48ac4", "#7d5a94"],
  ["#6f9aa8", "#42687a"], ["#89a68e", "#57755c"], ["#c99070", "#9c6444"], ["#8a8f9e", "#5b6070"],
  ["#d1917f", "#a35c4c"], ["#8f9f6b", "#5c7a52"],
];

/** A stable colour for someone without a photo, picked from the design's palette. */
export function gradientFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b] = GRADS[h % GRADS.length];
  return `linear-gradient(135deg,${a},${b})`;
}

export function presenceLabel(p: { presence: string; ends_on?: string | null; until?: string | null }) {
  const until = p.ends_on ?? p.until;
  return p.presence === "visiting" ? `Visiting${until ? ` until ${shortDate(until)}` : ""}` : "Lives here";
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
