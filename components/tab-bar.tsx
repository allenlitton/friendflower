"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import { LiveLocation } from "@/components/live-trip-prompt";

/** Fired once the World tab has marked the Concierge watch as seen, so the dot can go. */
export const CONCIERGE_SEEN = "concierge-seen";

const TABS = [
  { href: "/nearby", label: "Nearby", glyph: "❋", round: true },
  { href: "/world", label: "World", glyph: "⊕", round: true },
  { href: "/trips", label: "Trips", glyph: "✈", round: false },
  { href: "/places", label: "Places", glyph: "☕", round: false },
  { href: "/chats", label: "Chats", glyph: "✉", round: false },
  { href: "/you", label: "You", glyph: "", round: true },
];

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

export function TabBar({ myName, liveLocation }: { myName: string; liveLocation: boolean }) {
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
            <Link key={t.href} href={t.href} className="relative flex flex-col items-center gap-[4px] py-[3px]">
              <span className={`flex h-[32px] w-[32px] items-center justify-center font-bold text-white ${t.glyph ? "text-[17px]" : "text-[13px]"}`}
                style={{ borderRadius: t.round ? "50%" : 9, background: on ? "var(--color-pink)" : "#4d4740" }}>
                {t.glyph || initials(myName)}
              </span>
              <span className="text-[13.5px] leading-none font-bold" style={{ color: on ? "var(--color-pink)" : "var(--color-faint)" }}>{t.label}</span>
              {((t.href === "/chats" && chatDot) || (t.href === "/world" && watchDot)) && (
                <span className="absolute top-0 right-[18%] h-2.5 w-2.5 rounded-full border-[1.5px] border-well bg-pink" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
