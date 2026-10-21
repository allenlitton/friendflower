"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote, PrimaryButton } from "@/components/ui";
import { readRememberedEmail, rememberEmail } from "@/lib/remembered-email";

const noSubscribe = () => () => {};

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
  const [error, setError] = useState(params.get("error") === "link" ? "That sign-in link has expired. Try again." : "");

  useEffect(() => {
    // The home-screen app can reopen on this page after you've signed in.
    // Re-checking sends you straight into the app if you're still signed in.
    const recheck = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [router]);

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
