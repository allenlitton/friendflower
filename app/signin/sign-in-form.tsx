"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote, PrimaryButton } from "@/components/ui";
import { readRememberedEmail, rememberEmail } from "@/lib/remembered-email";
import { signInProviders, signInWith, SignInCancelled, type Provider } from "@/lib/social-sign-in";

const noSubscribe = () => () => {};
// A string so the snapshot stays stable between renders.
const providersSnapshot = () => signInProviders().join(",");

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  // null until they type, so the saved email shows without a flash of mismatch.
  const [typed, setEmail] = useState<string | null>(null);
  const savedEmail = useSyncExternalStore(noSubscribe, readRememberedEmail, () => "");
  const email = typed ?? savedEmail;
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(ERRORS[params.get("error") ?? ""] ?? "");
  // Empty until the page knows whether it's inside the iPhone app (see lib/social-sign-in).
  const providers = useSyncExternalStore(noSubscribe, providersSnapshot, () => "").split(",").filter(Boolean) as Provider[];

  useEffect(() => {
    // The home-screen app can reopen on this page after you've signed in.
    // Re-checking sends you straight into the app if you're still signed in.
    const recheck = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [router]);

  async function withProvider(provider: Provider) {
    setBusy(true);
    setError("");
    try {
      await signInWith(provider, next);
      // Only the iPhone app gets here; the website has already left for Apple or Google.
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (e) {
      setBusy(false);
      if (!(e instanceof SignInCancelled)) setError(`Couldn't sign in with ${provider === "apple" ? "Apple" : "Google"}. Try again, or use your email.`);
    }
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    // The review account can always go on to the code step, even if Supabase won't send another email yet.
    const isReview = error
      ? await fetch("/auth/review", { method: "POST", body: JSON.stringify({ email }) }).then((r) => r.json(), () => ({})).then((d) => !!d.review, () => false)
      : false;
    setBusy(false);
    if (error && !isReview) return setError(error.message);
    rememberEmail(email);
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    // The App Store review account signs in with a fixed code instead (see app/auth/review).
    const reviewOk = error
      ? await fetch("/auth/review", { method: "POST", body: JSON.stringify({ email, code }) }).then((r) => r.ok, () => false)
      : false;
    setBusy(false);
    if (error && !reviewOk) return setError("That code didn't work. Check the latest email and try again.");
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="flex flex-col gap-2.5">
        <div className="text-[16.2px] leading-normal text-muted">
          We sent a code to <span className="text-text">{email}</span>. Enter it here, or tap the link in the email.
          It can take a minute — check spam too.
        </div>
        <input className="field text-center font-display !text-[28px] tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code"
          maxLength={10} placeholder="······" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton type="submit" disabled={busy || code.length < 6}>{busy ? "checking…" : "sign in"}</PrimaryButton>
        <button type="button" className="text-[15px] font-semibold text-pink" onClick={() => { setStep("email"); setCode(""); }}>
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="flex flex-col gap-2.5">
      {providers.length > 0 && (
        <>
          {providers.map((p) => <ProviderButton key={p} provider={p} disabled={busy} onClick={() => withProvider(p)} />)}
          <div className="my-1 flex items-center gap-3 text-[13.8px] text-faint">
            <span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <input className="field" type="email" autoComplete="email" placeholder="you@example.com" required
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <ErrorNote>{error}</ErrorNote>
      <PrimaryButton type="submit" disabled={busy || !email.includes("@")}>{busy ? "sending…" : "continue with email"}</PrimaryButton>
      <p className="text-center text-[13.8px] leading-normal text-faint">
        By continuing you agree to our <a href="/terms" className="text-pink underline">Terms</a> and
        {" "}<a href="/privacy" className="text-pink underline">how we handle your data</a>.
      </p>
    </form>
  );
}

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired. Try again.",
  provider: "That sign-in didn't finish. Try again, or use your email.",
};

// Apple's and Google's own button styles: white, with their logo and "Continue with …".
function ProviderButton({ provider, disabled, onClick }: { provider: Provider; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="flex h-[50px] w-full items-center justify-center gap-2.5 rounded-[14px] bg-white text-[18px] font-medium text-black disabled:opacity-45"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Roboto, Arial, sans-serif" }}>
      {provider === "apple" ? <AppleLogo /> : <GoogleLogo />}
      Continue with {provider === "apple" ? "Apple" : "Google"}
    </button>
  );
}

function AppleLogo() {
  return (
    <svg width="17" height="20" viewBox="0 0 17 20" aria-hidden="true">
      <path fill="#000" d="M14.04 10.63c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.77-3.32-1.8-1.41-.14-2.76.83-3.47.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.38-3.69ZM11.77 3.88c.63-.77 1.06-1.83.94-2.88-.91.04-2.01.6-2.66 1.37-.58.67-1.1 1.76-.96 2.79 1.01.08 2.05-.52 2.68-1.28Z" />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
