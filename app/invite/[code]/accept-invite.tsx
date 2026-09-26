"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { PrimaryButton } from "@/components/ui";

export function AcceptInvite({ code, valid, signedIn }: { code: string; valid: boolean; signedIn: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    if (!signedIn) {
      // Remember the invite through sign-up; it's redeemed when the profile is saved.
      localStorage.setItem("ff_invite", code);
      router.push("/signin");
      return;
    }
    const { data: inviter } = await supabaseBrowser().rpc("redeem_invite", { p_code: code });
    if (inviter) router.push(`/people/${inviter}`);
    else {
      localStorage.setItem("ff_invite", code);
      router.push("/");
    }
  }

  if (!valid) return <PrimaryButton href="/signin" className="max-w-[320px]">join friend flower</PrimaryButton>;
  return (
    <PrimaryButton onClick={go} disabled={busy} className="max-w-[320px]">
      {signedIn ? "add as a friend" : "join friend flower"}
    </PrimaryButton>
  );
}
