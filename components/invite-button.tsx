"use client";

import { useState } from "react";
import { InviteSheet, inviteLink } from "@/components/invite-sheet";

/** Invite friends: opens the QR code + share sheet, with a quick "Copy link". */
export function InviteButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function copy() {
    await navigator.clipboard?.writeText(inviteLink(code));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3">
      <button type="button" onClick={() => setOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-plum text-[19.2px] font-bold text-pink">+</span>
        <div className="min-w-0 flex-1">
          <div className="text-[17.4px] font-semibold">Invite friends</div>
          <div className="text-[13.8px] text-muted">
            {copied ? "Invite link copied — paste it anywhere" : "Show your QR code or share your link"}
          </div>
        </div>
      </button>
      <button type="button" onClick={copy}
        className="flex-none rounded-full border-[1.5px] border-line px-3 py-1.5 text-[14.4px] font-bold whitespace-nowrap text-pink hover:border-[#5a534b]">
        {copied ? "Copied" : "Copy link"}
      </button>
      <InviteSheet code={code} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
