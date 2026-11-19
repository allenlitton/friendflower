"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * In the iPhone app, whenever it opens or comes back to the front: if an invite
 * link was just opened from this network (it bounced through the App Store page,
 * whose "Open" button lands here), add that friend and show their profile.
 * Covers app builds that can't open invite links directly. See app/api/invite.
 */
export function InviteHandoff() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let busy = false;
    async function check() {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const { code } = await fetch("/api/invite").then((r) => r.json());
        if (code) {
          const { data: inviter } = await supabaseBrowser().rpc("redeem_invite", { p_code: code });
          if (inviter) router.push(`/people/${inviter}`);
        }
      } catch {
        // Offline or similar: try again next time the app comes to the front.
      } finally {
        busy = false;
      }
    }
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [router]);

  return null;
}
