// The last email signed in with on this device, so the sign-in page can fill it in.
// Each browser (and the home-screen app) keeps its own copy.
const KEY = "ff-email";

export function readRememberedEmail() {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function rememberEmail(email: string) {
  try { if (email) localStorage.setItem(KEY, email.trim()); } catch {}
}
