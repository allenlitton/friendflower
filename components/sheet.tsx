"use client";

import { useEffect, type ReactNode } from "react";

/** Bottom sheet, as used for "Add a trip", "Add a school" and "Look ahead". */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(6,5,4,.6)]" onClick={onClose}>
      <div role="dialog" aria-modal aria-label={typeof title === "string" ? title : undefined}
        className="mx-auto max-h-[88dvh] w-full max-w-[440px] overflow-y-auto rounded-t-[22px] border-t-[1.5px] border-line bg-[#141312] px-[22px] pt-[18px] pb-[calc(24px+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-[38px] rounded-full bg-[#3a352e]" />
        <div className="flex items-center justify-between">
          <div className="font-display text-[26px]">{title}</div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-line bg-card text-[16.8px] text-soft">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
