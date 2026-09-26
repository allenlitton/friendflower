"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote, PrimaryButton } from "@/components/ui";

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(params.get("error") === "link" ? "That sign-in link has expired. Try again." : "");

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) return setError("That code didn't work. Check the latest email and try again.");
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="flex flex-col gap-2.5">
        <div className="text-[13.5px] leading-normal text-muted">
          We sent a code to <span className="text-text">{email}</span>. Enter it here, or tap the link in the email.
          It can take a minute — check spam too.
        </div>
        <input className="field text-center font-display !text-[28px] tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code"
          maxLength={10} placeholder="······" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
        <ErrorNote>{error}</ErrorNote>
        <PrimaryButton type="submit" disabled={busy || code.length < 6}>{busy ? "checking…" : "sign in"}</PrimaryButton>
        <button type="button" className="text-[12.5px] font-semibold text-pink" onClick={() => { setStep("email"); setCode(""); }}>
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
      <div className="mt-1 flex gap-2">
        {["Instagram", "Facebook"].map((n) => (
          <div key={n} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] border-[1.5px] border-line bg-[#161412] text-[12.5px] font-semibold text-faint">
            {n} <span className="rounded-full bg-gold-bg px-1.5 py-px text-[9.5px] font-bold text-gold">soon</span>
          </div>
        ))}
      </div>
    </form>
  );
}
