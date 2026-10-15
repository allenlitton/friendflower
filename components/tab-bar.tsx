"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Avatar, Flower } from "@/components/ui";
import { LiveLocation } from "@/components/live-trip-prompt";

/** Fired once the World tab has marked the Concierge watch as seen, so the dot can go. */
export const CONCIERGE_SEEN = "concierge-seen";

/** Icons only: the label is kept for screen readers. */
const TABS = [
  { href: "/nearby", label: "Nearby", glyph: "" },
  { href: "/world", label: "World", glyph: "" },
  { href: "/trips", label: "Trips & Deliveries", glyph: "✈" },
  { href: "/places", label: "Places", glyph: "☕" },
  { href: "/chats", label: "Chats", glyph: "✉" },
  { href: "/you", label: "You", glyph: "" },
];

function Globe({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="9.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9.5" />
      <path d="M2.5 12h19M4 7.2h16M4 16.8h16" />
    </svg>
  );
}

function TabIcon({ href, glyph, on, myName, myId, avatarUrl }: { href: string; glyph: string; on: boolean; myName: string; myId: string; avatarUrl: string | null }) {
  if (href === "/nearby") return <Flower size={42} stroke="#fff" strokeWidth={3.4} center="#fff" />;
  if (href === "/world") return <Globe size={32} />;
  if (href === "/you") return <Avatar id={myId} name={myName} src={avatarUrl} size={26} ring={on ? "2px solid var(--color-pink)" : "2px solid transparent"} />;
  return (
    <span className="flex h-[32px] w-[32px] items-center justify-center rounded-[9px] text-[17px] font-bold text-white"
      style={{ background: on ? "var(--color-pink)" : "#4d4740" }}>{glyph}</span>
  );
}

/** Keeps "online now" fresh while the app is open (only updates a timestamp). */
export function usePresence() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  useEffect(() => {
    const beat = () => document.visibilityState === "visible" && supabase.rpc("touch_presence").then(() => {});
    beat();
    const t = setInterval(beat, 120_000);
    document.addEventListener("visibilitychange", beat);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", beat); };
  }, [supabase]);
}

export function Presence({ liveLocation }: { liveLocation: boolean }) {
  usePresence();
  return <LiveLocation enabled={liveLocation} />;
}

export function TabBar({ myName, myId, avatarUrl, liveLocation }: { myName: string; myId: string; avatarUrl: string | null; liveLocation: boolean }) {
  usePresence();
  const path = usePathname();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [chatDot, setChatDot] = useState(false);
  const [watchDot, setWatchDot] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([supabase.rpc("my_chats"), supabase.rpc("inbox"), supabase.rpc("concierge_unseen_count")]).then(([chats, inbox, watch]) => {
      if (!alive) return;
      setWatchDot(typeof watch.data === "number" && watch.data > 0);
      const unread = (chats.data ?? []).some((c: { unread: boolean }) => c.unread);
      const waiting = inbox.data && (inbox.data.friend_requests.length > 0 || inbox.data.verifications.length > 0);
      setChatDot(unread || !!waiting);
    });
    const cleared = () => setWatchDot(false);
    window.addEventListener(CONCIERGE_SEEN, cleared);
    return () => { alive = false; window.removeEventListener(CONCIERGE_SEEN, cleared); };
  }, [supabase, path]);

  return (
    <>
      <LiveLocation enabled={liveLocation} />
      <nav className="sticky bottom-0 z-40 grid flex-none grid-cols-6 border-t border-line-soft bg-[rgba(19,18,17,.97)] px-1 pt-[8px] pb-[calc(5px+env(safe-area-inset-bottom))] backdrop-blur">
        {TABS.map((t) => {
          const on = path === t.href || path.startsWith(t.href + "/");
          return (
            <Link key={t.href} href={t.href} aria-label={t.label} className="relative flex h-[46px] items-center justify-center">
              <span className="flex items-center justify-center rounded-full"
                style={t.href === "/nearby" || t.href === "/world" ? { width: 44, height: 44, background: on ? "var(--color-pink)" : "transparent" } : undefined}>
                <TabIcon href={t.href} glyph={t.glyph} on={on} myName={myName} myId={myId} avatarUrl={avatarUrl} />
              </span>
              {((t.href === "/chats" && chatDot) || (t.href === "/world" && watchDot)) && (
                <span className="absolute top-0 right-[22%] h-2.5 w-2.5 rounded-full border-[1.5px] border-well bg-pink" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
