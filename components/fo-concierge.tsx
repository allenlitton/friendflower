"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote } from "@/components/ui";
import Link from "next/link";
import { FoFace } from "@/components/fo-face";

export type FoMessage = { id: number; role: "me" | "fo"; body: string; created_at: string };
export type FoThread = { status: "idle" | "working"; progress: string | null; messages: FoMessage[] };

const MAX_WAITS = 24; // ~10 minutes of waiting on one request while the sheet is open

/** Your one private chat with Fo, shown as a full page like any other chat. */
export function FoChat({ initial, initialDraft = "" }: { initial: FoThread; initialDraft?: string }) {
  const chatId = null;
  const page = "general";
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [thread, setThread] = useState<FoThread>(initial);
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const following = useRef(false);
  const shown = useRef(true);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("fo_thread", { p_chat: chatId });
    if (error) { setError(error.message); return null; }
    setThread(data as FoThread);
    return data as FoThread;
  }, [supabase, chatId]);

  // Wait for Fo's answer, refreshing the progress line as it goes.
  const follow = useCallback(async () => {
    if (following.current) return;
    following.current = true;
    try {
      for (let i = 0; i < MAX_WAITS && shown.current; i++) {
        const res = await fetch("/api/fo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId, page }) });
        const out = await res.json().catch(() => ({}));
        await load();
        if (!res.ok) { setError(out.error ?? "Something went wrong"); break; }
        if (out.status !== "working") break;
      }
    } finally {
      following.current = false;
    }
  }, [load]);

  useEffect(() => {
    shown.current = true;
    if (initial.status === "working") follow();
    return () => { shown.current = false; };
  }, [initial.status, follow]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [thread]);

  async function send(text: string) {
    text = text.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    setThread((t) => ({ status: "working", progress: null, messages: [...t.messages, { id: -Date.now(), role: "me", body: text, created_at: new Date().toISOString() }] }));
    const res = await fetch("/api/fo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId, page, text }) });
    const out = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) { setError(out.error ?? "Something went wrong"); setDraft(text); }
    const t = await load();
    if (t?.status === "working") follow();
  }

  const working = thread.status === "working" || sending;
  const ideas = ["Book a table for two this Friday", "Find me a flight for my next trip", "What's good near me tonight?"];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-[11px] border-b border-line-soft bg-well px-3.5 py-[9px]">
        <Link href="/chats" aria-label="Back" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-[17px] text-soft">‹</Link>
        <FoFace size={36} />
        <div className="min-w-0">
          <div className="truncate font-display text-[20px] leading-[1.1]">Fo</div>
          <div className="truncate text-[11px] text-muted">Your concierge · only you see this chat</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto px-4 py-3.5">
        {thread.messages.length === 0 && (
          <p className="px-2 py-4 text-center text-[13px] leading-normal text-muted">
            Fo finds the place, books the table, and sorts flights and deliveries.
          </p>
        )}
        {thread.messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] px-[13px] py-2.5 text-[14px] leading-[1.45] whitespace-pre-wrap ${m.role === "me"
            ? "self-end rounded-[16px_16px_5px_16px] bg-pink text-white"
            : "self-start rounded-[16px_16px_16px_5px] border-[1.5px] border-plum-line bg-plum text-[#f3d6df]"}`}>
            {m.body}
          </div>
        ))}
        {working && (
          <div className="self-start rounded-2xl bg-raised px-3 py-2 text-[12.5px] leading-snug text-muted" role="status">
            <span className="animate-pulse">✦</span> {thread.progress ?? "Fo is on it…"}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="flex-none border-t border-line-soft bg-well px-3.5 pt-2.5 pb-3">
        {thread.messages.length === 0 && !working && (
          <div className="mb-2.5 flex flex-wrap gap-[7px]">
            {ideas.map((idea) => (
              <button key={idea} type="button" onClick={() => setDraft(idea)}
                className="rounded-full border-[1.5px] border-plum-line bg-plum px-[13px] py-[7px] text-left text-[12.5px] font-semibold text-pink">{idea}</button>
            ))}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={1}
            placeholder={working ? "Fo is working on your request…" : "Ask Fo…"} disabled={working}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
            className="min-h-11 min-w-0 flex-1 resize-none rounded-[18px] border-[1.5px] border-line bg-card px-4 py-2.5 text-[16px] outline-none disabled:opacity-60" />
          <button type="submit" aria-label="Send to Fo" disabled={working || !draft.trim()}
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-[17px] text-ink hover:bg-pink-deep disabled:opacity-60">↑</button>
        </form>
      </div>
    </div>
  );
}

/** "Ask Fo Concierge" at the bottom of a page: an ecru button that opens your chat with Fo. */
export function AskFoButton() {
  return (
    <Link href="/fo"
      className="flex h-[50px] w-full flex-none items-center justify-center gap-2 rounded-[14px] bg-ecru font-display text-[22px] text-ink transition-colors hover:bg-ecru-deep">
      <FoFace size={28} /> Ask Fo Concierge
    </Link>
  );
}
