"use client";

import { useLayoutEffect, useRef, useState } from "react";

const MIN_LINES_TYPING = 4;
const MAX_LINES_TYPING = 8;

/**
 * The box you write a chat message in. One line while you're not using it; while you type it
 * opens to at least 4 lines so the whole message is easy to read, grows with the text up to
 * 8 lines (then scrolls), and shrinks back when you tap away.
 * On a computer Enter sends (Shift+Enter for a new line); on a phone Return adds a new line
 * and the send button sends.
 */
export function MessageBox({ value, onChange, onSend, placeholder, maxLength = 2000, label }: {
  value: string; onChange: (v: string) => void; onSend: () => void; placeholder: string; maxLength?: number; label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [typing, setTyping] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The textarea has no padding or border (the wrapper draws those), so its height is whole
    // lines and a collapsed box cuts off cleanly after the first line.
    const line = parseFloat(getComputedStyle(el).lineHeight);
    el.style.height = "auto";
    const lines = Math.min(Math.max(Math.round(el.scrollHeight / line), typing ? MIN_LINES_TYPING : 1), typing ? MAX_LINES_TYPING : 1);
    el.style.height = `${lines * line}px`;
    if (!typing) el.scrollTop = 0;
  }, [value, typing]);

  return (
    <div onClick={() => ref.current?.focus()}
      className="min-w-0 flex-1 cursor-text rounded-[22px] border-[1.5px] border-line bg-card px-4 py-2">
      <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength} rows={1}
        placeholder={placeholder} aria-label={label ?? placeholder}
        onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches) {
            e.preventDefault();
            onSend();
          }
        }}
        className="block w-full resize-none bg-transparent p-0 text-[19.2px] leading-[1.35] outline-none transition-[height] duration-150" />
    </div>
  );
}
