/** Friend Flower on the iOS App Store. */
export const APP_STORE_URL = "https://apps.apple.com/app/id6825094065";

/** iPhone/iPad Safari (iPadOS reports itself as a Mac, so check for touch too). */
export function isIOSBrowser() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}
