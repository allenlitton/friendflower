"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote } from "@/components/ui";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabaseBrowser().rpc("newsletter_signup", { p_email: email.trim() });
    setBusy(false);
    if (error) return setError("That didn't work. Check your email and try again.");
    setDone(true);
  }

  return (
    <div className="flex w-full max-w-[320px] flex-col gap-2">
      <div className="font-logo text-[15px] font-bold text-text">Newsletter</div>
      {done ? (
        <p className="text-[14.5px] text-[#b9b2a7]">Thanks! We&apos;ll keep you posted.</p>
      ) : (
        <form onSubmit={signUp} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1 !py-2" type="email" autoComplete="email" placeholder="you@example.com" required
              aria-label="Email for newsletter" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={busy || !email.includes("@")}
              className="flex-none rounded-[13px] border-[1.5px] border-pink px-4 text-[15px] font-semibold text-pink hover:bg-plum disabled:opacity-45">
              {busy ? "…" : "sign up"}
            </button>
          </div>
          <ErrorNote>{error}</ErrorNote>
        </form>
      )}
    </div>
  );
}
