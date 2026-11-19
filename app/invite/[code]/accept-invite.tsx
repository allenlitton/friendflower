"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { PrimaryButton } from "@/components/ui";
import { APP_STORE_URL, isIOSBrowser } from "@/lib/app-store";

type Where = "unknown" | "app" | "ios-web" | "web";

const noSubscribe = () => () => {};
const detect = (): Where => (Capacitor.isNativePlatform() ? "app" : isIOSBrowser() ? "ios-web" : "web");

/**
 * Signed-out visitors only (signed-in ones are added on the server).
 * - In the iPhone app: remember the invite and go straight to sign-up.
 * - iPhone without the app: straight to the App Store. The invite is noted for
 *   this network first, so it's redeemed once they sign up in the new app.
 * - Anywhere else: join on the web, as before.
 */
export function AcceptInvite({ code, valid }: { code: string; valid: boolean }) {
  const router = useRouter();
  const where = useSyncExternalStore(noSubscribe, detect, (): Where => "unknown");
  const signInUrl = `/signin?next=${encodeURIComponent(`/invite/${code}`)}`;

  function join() {
    // Remember the invite through sign-up; it's redeemed when the profile is saved.
    // Back here after sign-in, where an existing account is added straight away.
    localStorage.setItem("ff_invite", code);
    router.push(signInUrl);
  }

  function toAppStore() {
    fetch("/api/invite", { method: "POST", body: JSON.stringify({ code }), keepalive: true }).catch(() => {});
    window.location.href = APP_STORE_URL;
  }

  useEffect(() => {
    if (!valid) return;
    const w = detect();
    if (w === "app") {
      localStorage.setItem("ff_invite", code);
      router.replace(signInUrl);
    } else if (w === "ios-web") {
      toAppStore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!valid) return <PrimaryButton href="/signin" className="max-w-[320px]">join friend flower</PrimaryButton>;
  if (where === "ios-web") {
    return (
      <div className="flex w-full max-w-[320px] flex-col items-center gap-3">
        <PrimaryButton onClick={toAppStore}>get the app</PrimaryButton>
        <p className="text-[14.4px] leading-normal text-muted">
          Sign up in the app and you&apos;ll be friends automatically.{" "}
          <button type="button" onClick={join} className="text-pink underline-offset-2 hover:underline">Continue on the web</button>
        </p>
      </div>
    );
  }
  return (
    <PrimaryButton onClick={join} disabled={where !== "web"} className="max-w-[320px]">
      join friend flower
    </PrimaryButton>
  );
}
