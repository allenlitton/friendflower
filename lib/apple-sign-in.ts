import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Apple requires apps with Sign in with Apple to end it (revoke the token) when someone deletes
// their account. So we keep each person's Apple refresh token, and revoke it on deletion.
// Needs APPLE_SIGNIN_KEY_ID and APPLE_SIGNIN_PRIVATE_KEY (a .p8 key with Sign in with Apple on);
// the team is APPLE_TEAM_ID, or APNS_TEAM_ID when that's unset.

/** The app signs in as its bundle id; the website as the Services ID set up in Supabase. */
export const APPLE_APP_CLIENT_ID = "app.friendflower.ios";
export const APPLE_WEB_CLIENT_ID = process.env.APPLE_SERVICES_ID ?? "";

const TEAM_ID = process.env.APPLE_TEAM_ID ?? process.env.APNS_TEAM_ID ?? "";

export function appleSignInConfigured() {
  return !!(TEAM_ID && process.env.APPLE_SIGNIN_KEY_ID && process.env.APPLE_SIGNIN_PRIVATE_KEY);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

// Apple's client_secret: a short-lived JWT signed with the .p8 key.
function clientSecret(clientId: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_SIGNIN_KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId }));
  const key = createPrivateKey(process.env.APPLE_SIGNIN_PRIVATE_KEY!.replace(/\\n/g, "\n"));
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(sig)}`;
}

async function apple(path: string, clientId: string, params: Record<string, string>) {
  return fetch(`https://appleid.apple.com/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret(clientId), ...params }),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Swaps the app's one-time authorization code for a refresh token. Null if Apple says no. */
export async function exchangeAppleCode(code: string, clientId: string): Promise<string | null> {
  const res = await apple("token", clientId, { grant_type: "authorization_code", code });
  if (!res.ok) return null;
  const { refresh_token } = await res.json().catch(() => ({}));
  return typeof refresh_token === "string" ? refresh_token : null;
}

export async function saveAppleToken(userId: string, clientId: string, refreshToken: string) {
  await supabaseAdmin().rpc("srv_apple_token_save", { p_user: userId, p_client: clientId, p_token: refreshToken });
}

/**
 * Ends the person's Sign in with Apple, if we hold a token for them. Never throws: a failure
 * here mustn't stop the account from being deleted.
 */
export async function revokeAppleSignIn(userId: string) {
  if (!appleSignInConfigured()) return;
  try {
    const { data } = await supabaseAdmin().rpc("srv_apple_token_get", { p_user: userId });
    const row = (data as { client_id: string; refresh_token: string }[] | null)?.[0];
    if (row) await apple("revoke", row.client_id, { token: row.refresh_token, token_type_hint: "refresh_token" });
  } catch {}
}
