"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/sheet";
import { PrimaryButton, SecondaryButton } from "@/components/ui";
import { SIGNED_IN_COOKIE } from "@/lib/signed-in-cookie";

const NEVER_KEY = "ff-home-screen-never";

// Chrome on Android hands us this event so we can show its own install prompt.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

type Platform = "ios" | "android";

function platform(): Platform | null {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
}

function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** After sign-in in a phone browser, offers to add Friend Flower to the home screen. */
export function HomeScreenPrompt() {
  const [open, setOpen] = useState(false);
  const [os, setOs] = useState<Platform | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onInstallable = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onInstallable);

    // Waiting a moment lets the screen settle before the sheet slides up. The
    // marker is read (and cleared) only when the timer fires, so it's used once.
    const timer = setTimeout(() => {
      const justSignedIn = document.cookie.split("; ").some((c) => c === `${SIGNED_IN_COOKIE}=1`);
      if (!justSignedIn) return;
      document.cookie = `${SIGNED_IN_COOKIE}=; path=/; max-age=0`;
      let never = false;
      try { never = localStorage.getItem(NEVER_KEY) === "1"; } catch {}
      const os = platform();
      if (never || !os || isStandalone()) return;
      setOs(os);
      setOpen(true);
    }, 600);

    return () => { clearTimeout(timer); window.removeEventListener("beforeinstallprompt", onInstallable); };
  }, []);

  function never() {
    try { localStorage.setItem(NEVER_KEY, "1"); } catch {}
    setOpen(false);
  }

  async function addNow() {
    if (!install) return;
    await install.prompt();
    await install.userChoice;
    setInstall(null);
    setOpen(false);
  }

  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="Add to home screen?">
      <p className="mt-2 text-[16.8px] leading-relaxed text-soft">
        Open Friend Flower from an icon on your home screen, like any other app. It stays signed in.
      </p>

      {os === "android" && install ? (
        <div className="mt-5 flex flex-col gap-2.5">
          <PrimaryButton onClick={addNow}>add to home screen</PrimaryButton>
          <SecondaryButton onClick={() => setOpen(false)}>Not now</SecondaryButton>
        </div>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-2.5 text-[16.8px] leading-snug text-text">
            {os === "ios" ? (
              <>
                <Step n={1}>Tap the <b>Share</b> button <ShareIcon /> in Safari.</Step>
                <Step n={2}>Scroll down and tap <b>Add to Home Screen</b>.</Step>
                <Step n={3}>Tap <b>Add</b>.</Step>
              </>
            ) : (
              <>
                <Step n={1}>Tap the <b>⋮</b> menu in your browser.</Step>
                <Step n={2}>Tap <b>Add to Home screen</b> or <b>Install app</b>.</Step>
              </>
            )}
          </ol>
          <p className="mt-3 text-[15px] leading-normal text-muted">
            The icon keeps its own sign-in, so you&apos;ll sign in once more there. Type the 6-digit code from the email
            rather than tapping the link.
          </p>
          <div className="mt-5 flex flex-col gap-2.5">
            <PrimaryButton onClick={() => setOpen(false)}>got it</PrimaryButton>
          </div>
        </>
      )}

      <button type="button" onClick={never} className="mx-auto mt-3 block text-[15px] font-semibold text-muted">
        Don&apos;t ask again
      </button>
    </Sheet>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-card font-display text-[17px] text-pink">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden width="15" height="17" viewBox="0 0 15 17" className="inline -mt-1 align-middle" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 1v10M4 4.5 7.5 1 11 4.5M5 7H2.5v8.5h10V7H10" />
    </svg>
  );
}
