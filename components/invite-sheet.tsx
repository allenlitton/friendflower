"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Sheet } from "@/components/sheet";
import { isIOSBrowser } from "@/lib/app-store";

const MESSAGE = "Join me on Friend Flower so we can see when we're in the same city:";

/** The public invite link. Always friendflower.app, so links shared from the app open the app. */
export function inviteLink(code: string) {
  const origin = typeof location !== "undefined" && location.hostname === "localhost" ? location.origin : "https://friendflower.app";
  return `${origin}/invite/${code}`;
}

/**
 * "Invite friends": a QR code to scan in person, plus one-tap sharing to
 * Messages, WhatsApp, email and Instagram DMs (and the system share sheet).
 */
export function InviteSheet({ code, open, onClose }: { code: string; open: boolean; onClose: () => void }) {
  const link = inviteLink(code);
  const text = `${MESSAGE} ${link}`;
  const [qr, setQr] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0d0c0b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [open, link]);

  function flash(msg: string) {
    setNote(msg);
    setTimeout(() => setNote(""), 3000);
  }

  async function copy() {
    await navigator.clipboard?.writeText(link).catch(() => {});
    flash("Invite link copied");
  }

  async function instagram() {
    // Instagram has no "share this text to a DM" link, so copy it and open the DM inbox.
    await navigator.clipboard?.writeText(link).catch(() => {});
    flash("Link copied. Paste it into an Instagram DM");
    setTimeout(() => {
      window.location.href = isIOSBrowser() ? "instagram://direct-inbox" : "https://www.instagram.com/direct/inbox/";
    }, 700);
  }

  async function more() {
    // Just the URL: with extra text, iOS "Copy" and some apps drop the link.
    if (navigator.share) await navigator.share({ url: link }).catch(() => {});
    else await copy();
  }

  const options: { label: string; icon: string; bg: string; href?: string; onClick?: () => void; external?: boolean }[] = [
    { label: "Messages", icon: "💬", bg: "#1f7a34", href: `sms:&body=${encodeURIComponent(text)}` },
    { label: "WhatsApp", icon: "🟢", bg: "#0f5132", href: `https://wa.me/?text=${encodeURIComponent(text)}`, external: true },
    { label: "Email", icon: "✉️", bg: "#2b2f4a", href: `mailto:?subject=${encodeURIComponent("Join me on Friend Flower")}&body=${encodeURIComponent(text)}` },
    { label: "Instagram", icon: "📸", bg: "#5a1f45", onClick: instagram },
    { label: "Copy link", icon: "🔗", bg: "#2a2622", onClick: copy },
    { label: "More", icon: "⋯", bg: "#2a2622", onClick: more },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <p className="mt-1.5 text-[15px] leading-snug text-muted">
        Anyone who joins with your link is added as your friend.
      </p>

      <div className="mt-4 flex flex-col items-center gap-2">
        <div className="h-[208px] w-[208px] overflow-hidden rounded-[18px] bg-white p-2.5"
          aria-label="QR code for your invite link" role="img"
          dangerouslySetInnerHTML={{ __html: qr }} />
        <div className="text-[14.4px] text-muted">Have a friend scan this with their camera</div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {options.map((o) => {
          const inner = (
            <>
              <span className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] text-[22px]" style={{ background: o.bg }}>{o.icon}</span>
              <span className="text-[13.8px] font-semibold text-soft">{o.label}</span>
            </>
          );
          const cls = "flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] border-line bg-card py-3 hover:border-[#5a534b]";
          return o.href ? (
            <a key={o.label} href={o.href} className={cls} {...(o.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{inner}</a>
          ) : (
            <button key={o.label} type="button" onClick={o.onClick} className={cls}>{inner}</button>
          );
        })}
      </div>

      <div className="mt-3 min-h-[20px] text-center text-[14.4px] text-pink" aria-live="polite">{note}</div>
    </Sheet>
  );
}

/** A button that opens the invite sheet. */
export function InviteFriendsButton({ code, label = "Invite friends to Friend Flower", className = "" }: { code: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-[13px] text-left hover:border-[#5a534b] ${className}`}>
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-plum text-[19.2px] font-bold text-pink">+</span>
        <div className="min-w-0 flex-1">
          <div className="text-[16.8px] font-semibold">{label}</div>
          <div className="text-[13.8px] text-muted">QR code, Messages, WhatsApp, email or Instagram</div>
        </div>
        <span className="text-[20.4px] text-pink">›</span>
      </button>
      <InviteSheet code={code} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
