"use client";

import { useState } from "react";
import type { VerificationStatus } from "@/lib/types";
import { ErrorNote, PrimaryButton, SecondaryButton } from "@/components/ui";
import { useRpc } from "@/components/person-actions";

export function ConfirmLink({ token, status, canConfirm, needsName, confirmedBy, onboarded }: {
  token: string; status: VerificationStatus; canConfirm: boolean; needsName: boolean;
  confirmedBy: string | null; onboarded: boolean;
}) {
  const { call, busy, error, supabase, router } = useRpc();
  const [name, setName] = useState("");
  const [done, setDone] = useState<null | boolean>(null);

  if (done !== null || status === "confirmed" || status === "declined") {
    const yes = done ?? status === "confirmed";
    return (
      <div className="flex w-full max-w-[320px] flex-col gap-3">
        <p className="text-[14px] text-body">{yes ? `Thanks${confirmedBy && done === null ? ` — ${confirmedBy} already confirmed this` : ""}! They're now verified.` : "Thanks for letting them know."}</p>
        <PrimaryButton href={onboarded ? "/nearby" : "/onboarding"}>{onboarded ? "open friend flower" : "create your profile"}</PrimaryButton>
      </div>
    );
  }
  if (status === "expired" || status === "cancelled") return <p className="text-[14px] text-muted">This request has expired.</p>;
  if (!canConfirm) return <p className="text-[14px] text-muted">This link is for the mutual friend to open — send it to them.</p>;

  async function answer(yes: boolean) {
    if (needsName) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from("profiles").update({ first_name: name.trim() }).eq("id", user.id);
    }
    const ok = await call("confirm_verification_link", { p_token: token, p_confirm: yes });
    if (ok !== undefined) { setDone(yes); router.refresh(); }
  }

  return (
    <div className="flex w-full max-w-[320px] flex-col gap-2">
      {needsName && (
        <input className="field" placeholder="Your first name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      )}
      <PrimaryButton disabled={busy || (needsName && !name.trim())} onClick={() => answer(true)}>yes, I know them both</PrimaryButton>
      <SecondaryButton disabled={busy || (needsName && !name.trim())} onClick={() => answer(false)}>I don&apos;t know them both</SecondaryButton>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
