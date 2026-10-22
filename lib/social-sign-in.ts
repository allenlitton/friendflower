"use client";

import { Capacitor } from "@capacitor/core";
import { SocialLogin } from "@capgo/capacitor-social-login";
import { supabaseBrowser } from "@/lib/supabase/client";

export type Provider = "apple" | "google";

const BUNDLE_ID = "app.friendflower.ios";
const GOOGLE_IOS_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

// Switched on with NEXT_PUBLIC_SIGNIN_PROVIDERS="apple,google" once each is set up in Supabase,
// so the buttons never show before they work.
const ENABLED = (process.env.NEXT_PUBLIC_SIGNIN_PROVIDERS ?? "")
  .split(",").map((p) => p.trim()).filter((p): p is Provider => p === "apple" || p === "google");

/** True inside the iPhone app, once this build includes the sign-in plugin. */
function hasNativeSignIn() {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SocialLogin");
}

/**
 * The sign-in buttons to show. Google blocks its sign-in page inside the app's web view, so
 * the iPhone app only offers what its build can do natively (none on builds before 1.1).
 */
export function signInProviders(): Provider[] {
  if (!Capacitor.isNativePlatform()) return ENABLED;
  if (!hasNativeSignIn()) return [];
  return ENABLED.filter((p) => p === "apple" || GOOGLE_IOS_CLIENT_ID);
}

/** Thrown when the person closes the Apple or Google sheet themselves. */
export class SignInCancelled extends Error {}

/**
 * Signs in with Apple or Google. On the web this leaves the page for the provider and comes
 * back through /auth/confirm; in the app it resolves once signed in.
 */
export async function signInWith(provider: Provider, next: string) {
  const supabase = supabaseBrowser();
  if (!Capacitor.isNativePlatform()) {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    if (error) throw error;
    return;
  }

  // Apple and Google put the hashed nonce in their token; Supabase checks it against the raw one.
  const nonce = crypto.randomUUID();
  const hashed = await sha256(nonce);
  await initialize();
  try {
    if (provider === "apple") {
      const { result } = await SocialLogin.login({ provider: "apple", options: { scopes: ["email", "name"], nonce: hashed } });
      if (!result.idToken) throw new Error("Apple didn't return a sign-in token");
      const { error } = await supabase.auth.signInWithIdToken({ provider: "apple", token: result.idToken, nonce });
      if (error) throw error;
      // Apple only shares the name on the first sign-in, so keep it for onboarding.
      const name = [result.profile.givenName, result.profile.familyName].filter(Boolean).join(" ");
      if (name) await supabase.auth.updateUser({ data: { full_name: name } });
      // Kept so deleting the account can also end the Apple sign-in, as Apple requires.
      if (result.authorizationCode) {
        await fetch("/api/auth/apple-token", { method: "POST", body: JSON.stringify({ code: result.authorizationCode }) }).catch(() => {});
      }
    } else {
      const { result } = await SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile"], nonce: hashed } });
      const idToken = "idToken" in result ? result.idToken : null;
      if (!idToken) throw new Error("Google didn't return a sign-in token");
      const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken, nonce });
      if (error) throw error;
    }
  } catch (e) {
    if (/cancel/i.test(String((e as Error)?.message ?? e))) throw new SignInCancelled();
    throw e;
  }
}

let ready: Promise<unknown> | null = null;
function initialize() {
  ready ??= SocialLogin.initialize({
    apple: { clientId: BUNDLE_ID, useProperTokenExchange: true },
    ...(GOOGLE_IOS_CLIENT_ID ? { google: { iOSClientId: GOOGLE_IOS_CLIENT_ID, mode: "online" as const } } : {}),
  }).catch((e) => { ready = null; throw e; });
  return ready;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
