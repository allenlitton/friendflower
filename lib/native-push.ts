import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

/** True inside the Friend Flower iPhone app, once this build includes the push plugin. */
export function hasNativePush() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("PushNotifications");
}

const TOKEN_KEY = "ff-push-token";
const OFF_KEY = "ff-push-off";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

/** False once the person has switched notifications off in Settings on this phone. */
export function pushWanted() {
  return read(OFF_KEY) === null;
}

export type PushState = "on" | "off" | "blocked";

/** "blocked" means iOS notifications are off for the app, which only the iOS Settings app can change. */
export async function pushState(): Promise<PushState> {
  if (!hasNativePush()) return "off";
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive === "denied") return "blocked";
  return perm.receive === "granted" && pushWanted() ? "on" : "off";
}

let listening = false;

async function listen(onOpen: (url: string) => void) {
  if (listening) return;
  listening = true;
  await PushNotifications.addListener("registration", async ({ value }) => {
    write(TOKEN_KEY, value);
    await fetch("/api/push/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: value }),
    }).catch(() => {});
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const url = notification.data?.url;
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) onOpen(url);
  });
}

/**
 * Registers this phone for notifications (iOS shows its permission prompt the first time).
 * Returns false if the person said no. `onOpen` is called with an in-app path when a notification is tapped.
 */
export async function enablePush(onOpen: (url: string) => void): Promise<boolean> {
  if (!hasNativePush()) return false;
  await listen(onOpen);
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
  if (perm.receive !== "granted") return false;
  write(OFF_KEY, null);
  await PushNotifications.register();
  return true;
}

/**
 * Clears the number on the app icon and the notifications waiting in Notification Center.
 * Called whenever the app comes to the front; the next notification brings back an up-to-date count.
 */
export async function clearBadge() {
  if (!hasNativePush()) return;
  await PushNotifications.removeAllDeliveredNotifications().catch(() => {});
}

/** Opens Friend Flower's page in the iPhone Settings app, where banners, sounds and lock-screen display are chosen. */
export function openIosSettings() {
  window.location.href = "app-settings:";
}

/** Stops notifications for this phone, e.g. on sign-out or when switched off in Settings. */
export async function disablePush(remember = false) {
  if (!hasNativePush()) return;
  if (remember) write(OFF_KEY, "1");
  const token = read(TOKEN_KEY);
  if (!token) return;
  write(TOKEN_KEY, null);
  await fetch("/api/push/register", {
    method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
  }).catch(() => {});
}
