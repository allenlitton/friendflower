"use client";

import { useRef, useState, type ReactNode } from "react";
import { ErrorNote } from "@/components/ui";
import { useRpc } from "@/components/person-actions";

const REVEAL = 88;
const TRIGGER = 8;

/**
 * Wraps a chat row so it slides left to reveal a Delete button. Deleting only removes the chat for you;
 * the other person keeps theirs, and the chat returns (with just the new messages) if they write again.
 */
export function SwipeToDelete({ chatId, pod, name, children }: { chatId: string; pod: boolean; name: string; children: ReactNode }) {
  const { call, busy, error, router } = useRpc();
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const swiped = useRef(false);

  function down(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY, base: offset };
    swiped.current = false;
  }

  function move(e: React.PointerEvent) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!swiped.current) {
      if (Math.abs(dx) < TRIGGER || Math.abs(dx) < Math.abs(dy)) return;
      swiped.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setOffset(Math.max(-REVEAL - 24, Math.min(0, s.base + dx)));
  }

  function up() {
    if (!start.current) return;
    start.current = null;
    if (!swiped.current) return;
    setDragging(false);
    setOffset((o) => (o < -REVEAL / 2 ? -REVEAL : 0));
  }

  async function remove() {
    const msg = pod
      ? `Delete this chat with ${name}? You'll leave it, and the others can keep talking.`
      : `Delete this chat with ${name}? It's removed for you only, and comes back if they message you again.`;
    if (!confirm(msg)) return setOffset(0);
    const ok = await call("delete_chat", { p_chat: chatId });
    if (ok === undefined) return setOffset(0);
    router.refresh();
  }

  return (
    <div className="relative overflow-hidden rounded-[15px]">
      <button type="button" onClick={remove} disabled={busy} tabIndex={offset === 0 ? -1 : 0} aria-label={`Delete chat with ${name}`}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-[#b4493f] text-[15.6px] font-bold text-white disabled:opacity-60"
        style={{ width: REVEAL, visibility: offset === 0 && !dragging ? "hidden" : "visible" }}>
        {busy ? "…" : "Delete"}
      </button>
      <div
        className="relative"
        style={{
          transform: `translateX(${offset}px)`, transition: dragging ? "none" : "transform 180ms ease-out", touchAction: "pan-y",
          // Opaque only while sliding, so it hides the Delete button but doesn't tint the resting list.
          background: offset === 0 && !dragging ? "transparent" : "var(--color-bg)",
        }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        // A swipe, or a tap while a row is open, closes/ignores instead of opening the chat.
        onClickCapture={(e) => {
          if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; }
          else if (offset !== 0) { e.preventDefault(); e.stopPropagation(); setOffset(0); }
        }}>
        {children}
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
