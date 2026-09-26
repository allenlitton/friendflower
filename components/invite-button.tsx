"use client";

import { useState } from "react";
import { RowLink } from "@/components/ui";

/** Share (or copy) your personal invite link. Joining through it makes you friends. */
export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const url = `${location.origin}/invite/${code}`;
    const data = { title: "Join me on Friend Flower", text: "Meet friends of friends wherever you are.", url };
    if (navigator.share) {
      await navigator.share(data).catch(() => {});
    } else {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }
  return (
    <RowLink onClick={share} icon="+" title="Invite friends"
      note={copied ? "Invite link copied — share it anywhere" : "Anyone who joins with your link is added as a friend"} />
  );
}
