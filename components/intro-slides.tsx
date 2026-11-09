"use client";

import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { Flower, PetalHalo } from "@/components/ui";
import { TAB_PATHS } from "@/components/tab-bar";
import { FoFace } from "@/components/fo-face";

// Shown once, the first time someone opens the iPhone app. Add ?intro=1 to the
// sign-in page to see it again (on the web too).
const SEEN_KEY = "ff-intro-seen";

const noSubscribe = () => () => {};

function shouldShow() {
  try {
    if (new URLSearchParams(location.search).get("intro") === "1") return true;
    return Capacitor.isNativePlatform() && localStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

function TabGlyph({ href }: { href: string }) {
  return (
    <svg width={44} height={44} viewBox="0 0 24 24" fill="none" stroke="var(--color-pink)" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {TAB_PATHS[href]}
    </svg>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <PetalHalo size={150}>
      <div className="flex h-[92px] w-[92px] items-center justify-center rounded-full border-[1.5px] border-line bg-card">
        {children}
      </div>
    </PetalHalo>
  );
}

const SLIDES: { art: ReactNode; title: string; body: string }[] = [
  {
    art: <Flower size={110} stroke="#ffffff" strokeWidth={2.1} />,
    title: "welcome to friend flower.",
    body: "Mutual connections are magical. Here's a quick look at how it works.",
  },
  {
    art: <Badge><Flower size={48} strokeWidth={3.4} /></Badge>,
    title: "See who's nearby",
    body: "Find friends, and friends of friends, close to you right now — with how many mutual friends you share.",
  },
  {
    art: <Badge><TabGlyph href="/world" /></Badge>,
    title: "Know where friends are",
    body: "See where in the world your friends are, and add your trips so they know when you're coming to town.",
  },
  {
    art: <Badge><TabGlyph href="/places" /></Badge>,
    title: "Meet up in person",
    body: "Chat, see how you're connected, and pick a good spot to meet from places your friends love.",
  },
  {
    art: <Badge><FoFace size={60} /></Badge>,
    title: "Let Fo Concierge help",
    body: "Ask Fo Concierge to plan the details — a table, a time, a reminder — so you can just show up.",
  },
];

export function IntroSlides() {
  const show = useSyncExternalStore(noSubscribe, shouldShow, () => false);
  const [done, setDone] = useState(false);
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const last = index === SLIDES.length - 1;

  if (!show || done) return null;

  function finish() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    setDone(true);
  }

  function goTo(i: number) {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to Friend Flower"
      className="fixed inset-0 z-50 mx-auto flex w-full max-w-[440px] flex-col bg-bg pt-[env(safe-area-inset-top)] pb-[calc(22px+env(safe-area-inset-bottom))] sm:border-x sm:border-line-soft">
      <div className="flex h-[52px] flex-none items-center justify-end px-4">
        {!last && (
          <button type="button" onClick={finish}
            className="rounded-full px-3 py-1.5 text-[16.2px] font-semibold text-muted hover:text-text">
            Skip
          </button>
        )}
      </div>

      <div ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / el.clientWidth));
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
        {SLIDES.map((s, i) => (
          <section key={s.title} aria-hidden={i !== index}
            className="flex w-full flex-none snap-center flex-col items-center justify-center gap-7 px-[30px] text-center">
            <div className="flex h-[160px] items-center justify-center">{s.art}</div>
            <div className="flex flex-col gap-3">
              <h2 className={i === 0
                ? "font-logo text-[34px] leading-[1.05] font-extrabold tracking-[.5px]"
                : "font-display text-[34px] leading-[1.1]"}>
                {s.title}
              </h2>
              <p className="mx-auto max-w-[300px] text-[17.4px] leading-relaxed text-body">{s.body}</p>
            </div>
          </section>
        ))}
      </div>

      <div className="flex flex-none flex-col gap-5 px-[26px]">
        <div className="flex justify-center gap-2" role="tablist" aria-label="Slides">
          {SLIDES.map((s, i) => (
            <button key={s.title} type="button" role="tab" aria-selected={i === index} aria-label={`Slide ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-2 rounded-full transition-all ${i === index ? "w-6 bg-pink" : "w-2 bg-line"}`} />
          ))}
        </div>
        <button type="button" onClick={() => (last ? finish() : goTo(index + 1))}
          className="flex h-[50px] w-full items-center justify-center rounded-[14px] bg-pink font-display text-[22px] text-ink transition-colors hover:bg-pink-deep">
          {last ? "get started" : "next"}
        </button>
      </div>
    </div>
  );
}
