"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { clearBadge, enablePush, hasNativePush, pushWanted } from "@/lib/native-push";

/**
 * In the iPhone app, signed-in screens keep this phone registered for notifications (iOS asks
 * for permission once) and open the right screen when a notification is tapped. Does nothing on
 * the website, or if notifications were switched off in Settings. Opening the app clears the
 * unread number on its icon.
 */
export function PushSetup() {
  const router = useRouter();
  useEffect(() => {
    if (!hasNativePush() || !pushWanted()) return;
    enablePush((url) => router.push(url)).then(clearBadge).catch(() => {});
    const onShow = () => { if (document.visibilityState === "visible") clearBadge(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [router]);
  return null;
}
