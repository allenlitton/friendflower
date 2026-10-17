"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Avatar, Flower } from "@/components/ui";
import { LiveLocation } from "@/components/live-trip-prompt";

/** Fired once the World tab has marked the Fo Concierge watch as seen, so the dot can go. */
export const CONCIERGE_SEEN = "concierge-seen";

/** Icons only: the label is kept for screen readers. */
const TABS = [
  { href: "/nearby", label: "Nearby" },
  { href: "/world", label: "World" },
  { href: "/trips", label: "Trips & Deliveries" },
  { href: "/places", label: "Places" },
  { href: "/chats", label: "Chats" },
  { href: "/you", label: "You" },
];

/** Every tab icon is drawn at this size, so they all line up. */
const ICON = 30;

/** White line icons on a 24-unit grid; the open tab turns pink. */
const PATHS: Record<string, React.ReactNode> = {
  "/world": (<><circle cx="12" cy="12" r="9.5" /><ellipse cx="12" cy="12" rx="4" ry="9.5" /><path d="M2.5 12h19M4 7.2h16M4 16.8h16" /></>),
  "/trips": <path d="M10.2 13.8 3 11.5l1.4-1.4 8.1.8 4.3-4.3c.8-.8 2.2-.9 2.9-.2.7.7.6 2.1-.2 2.9l-4.3 4.3.8 8.1-1.4 1.4-2.3-7.2-3.4 3.4.3 2.6-1.1 1.1-1.6-3.2-3.2-1.6 1.1-1.1 2.6.3z" />,
  "/places": (<><path d="M4 9h13v5a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z" /><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17" /><path d="M8 3.5v2.5M11 3.5v2.5M14 3.5v2.5" /></>),
  "/chats": (<><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.8 7 8.2 6 8.2-6" /></>),
};

function TabIcon({ href, on, myName, myId, avatarUrl }: { href: string; on: boolean; myName: string; myId: string; avatarUrl: string | null }) {
  const color = on ? "var(--color-pink)" : "#fff";
  if (href === "/nearby") return <Flower size={ICON} stroke={color} strokeWidth={3.4} center={color} />;
  if (href === "/you") return <Avatar id={myId} name={myName} src={avatarUrl} size={ICON} ring={on ? "2px solid var(--color-pink)" : "2px solid transparent"} />;
  return (
    <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[href]}
    </svg>
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
              <TabIcon href={t.href} on={on} myName={myName} myId={myId} avatarUrl={avatarUrl} />
              {((t.href === "/chats" && chatDot) || (t.href === "/world" && watchDot)) && (
                <span className="absolute top-[3px] right-[22%] h-2.5 w-2.5 rounded-full border-[1.5px] border-well bg-pink" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
