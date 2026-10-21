"use client";

import { useState } from "react";
import { useRpc } from "@/components/person-actions";
import { ErrorNote, PrimaryButton } from "@/components/ui";

export function RedeemCode() {
  const { supabase, router } = useRpc();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function redeem() {
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("redeem_code", { p_code: code });
    setBusy(false);
    if (error || data?.error) return setError(data?.error ?? error?.message ?? "Something went wrong");
    setCode("");
    router.refresh();
  }

  return (
    <form className="flex flex-col gap-2.5" onSubmit={(e) => { e.preventDefault(); redeem(); }}>
      <input className="field uppercase" placeholder="Enter code" autoCapitalize="characters" autoComplete="off" spellCheck={false}
        maxLength={40} value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
      <ErrorNote>{error}</ErrorNote>
      <PrimaryButton type="submit" disabled={busy || !code.trim()}>{busy ? "checking…" : "redeem"}</PrimaryButton>
    </form>
  );
}
