"use client";

import { useState } from "react";

/** Share (or copy) your personal invite link. Joining through it makes you friends. */
export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = () => `${location.origin}/invite/${code}`;

  async function copy() {
    await navigator.clipboard?.writeText(link());
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    // Share just the link: with extra text, iOS "Copy" and some apps (WhatsApp) drop the link.
    // The preview image and title carry the branding.
    if (navigator.share) await navigator.share({ url: link() }).catch(() => {});
    else await copy();
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3">
      <button type="button" onClick={share} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-plum text-[19.2px] font-bold text-pink">+</span>
        <div className="min-w-0 flex-1">
          <div className="text-[17.4px] font-semibold">Invite friends</div>
          <div className="text-[13.8px] text-muted">
            {copied ? "Invite link copied — paste it anywhere" : "Anyone who joins with your link is added as a friend"}
          </div>
        </div>
      </button>
      <button type="button" onClick={copy}
        className="flex-none rounded-full border-[1.5px] border-line px-3 py-1.5 text-[14.4px] font-bold whitespace-nowrap text-pink hover:border-[#5a534b]">
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
