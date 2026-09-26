"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { initials } from "@/lib/format";

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

export function Presence() {
  usePresence();
  return null;
}

export function TabBar({ myName }: { myName: string }) {
  usePresence();
  const path = usePathname();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [chatDot, setChatDot] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([supabase.rpc("my_chats"), supabase.rpc("inbox")]).then(([chats, inbox]) => {
      if (!alive) return;
      const unread = (chats.data ?? []).some((c: { unread: boolean }) => c.unread);
      const waiting = inbox.data && (inbox.data.friend_requests.length > 0 || inbox.data.verifications.length > 0);
      setChatDot(unread || !!waiting);
    });
    return () => { alive = false; };
  }, [supabase, path]);

  return (
    <nav className="sticky bottom-0 z-40 grid flex-none grid-cols-6 border-t border-line-soft bg-[rgba(19,18,17,.97)] px-1.5 pt-[7px] pb-[calc(4px+env(safe-area-inset-bottom))] backdrop-blur">
      {TABS.map((t) => {
        const on = path === t.href || path.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href} className="relative flex flex-col items-center gap-[3px] py-[3px]">
            <span className="flex h-[21px] w-[21px] items-center justify-center text-[9px] font-bold text-white"
              style={{ borderRadius: t.round ? "50%" : 7, background: on ? "var(--color-pink)" : "#4d4740" }}>
              {t.glyph || initials(myName)}
            </span>
            <span className="text-[10px] font-bold" style={{ color: on ? "var(--color-pink)" : "var(--color-faint)" }}>{t.label}</span>
            {t.href === "/chats" && chatDot && (
              <span className="absolute top-0 right-[22%] h-2 w-2 rounded-full border-[1.5px] border-well bg-pink" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
