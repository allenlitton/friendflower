"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote } from "@/components/ui";
import { Sheet } from "@/components/sheet";

type FoMessage = { id: number; role: "me" | "fo"; body: string; created_at: string };
type FoThread = { status: "idle" | "working"; progress: string | null; messages: FoMessage[] };

const MAX_WAITS = 24; // ~10 minutes of waiting on one request while the sheet is open

/** Your private thread with Fo Concierge for this chat. */
export function FoConciergeSheet({ open, onClose, chatId, others }: {
  open: boolean; onClose: () => void; chatId: string; others: string[];
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [thread, setThread] = useState<FoThread>({ status: "idle", progress: null, messages: [] });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const following = useRef(false);
  const shown = useRef(open);
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
        const res = await fetch("/api/fo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId }) });
        const out = await res.json().catch(() => ({}));
        await load();
        if (!res.ok) { setError(out.error ?? "Something went wrong"); break; }
        if (out.status !== "working") break;
      }
    } finally {
      following.current = false;
    }
  }, [chatId, load]);

  useEffect(() => {
    shown.current = open;
    if (!open) return;
    supabase.rpc("fo_thread", { p_chat: chatId }).then(({ data, error }) => {
      if (error) { setError(error.message); return; }
      setThread(data as FoThread);
      if ((data as FoThread).status === "working") follow();
    });
  }, [open, supabase, chatId, follow]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [thread]);

  async function send(text: string) {
    text = text.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    setDraft("");
    setThread((t) => ({ status: "working", progress: null, messages: [...t.messages, { id: -Date.now(), role: "me", body: text, created_at: new Date().toISOString() }] }));
    const res = await fetch("/api/fo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId, text }) });
    const out = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) { setError(out.error ?? "Something went wrong"); setDraft(text); }
    const t = await load();
    if (t?.status === "working") follow();
  }

  const working = thread.status === "working" || sending;
  const who = others.length ? others.join(" and ") : "your friend";
  const ideas = [`Book a table for me and ${who}`, "Find somewhere halfway between us", "What's good near me tonight?"];

  return (
    <Sheet open={open} onClose={onClose} title="Fo Concierge">
      <p className="mt-1.5 text-[13px] leading-normal text-muted">
        Fo finds the place, books the table and sorts the details. Only you see this thread.
      </p>

      <div className="mt-3.5 flex flex-col gap-[7px]">
        {thread.messages.map((m) => (
          <div key={m.id} className={`max-w-[85%] px-[13px] py-2.5 text-[14px] leading-[1.45] whitespace-pre-wrap ${m.role === "me"
            ? "self-end rounded-[16px_16px_5px_16px] bg-pink text-white"
            : "self-start rounded-[16px_16px_16px_5px] border-[1.5px] border-plum-line bg-plum text-[#f3d6df]"}`}>
            {m.role === "fo" && <div className="mb-[3px] text-[10.5px] font-bold tracking-[.05em] text-pink uppercase">Fo</div>}
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

      {thread.messages.length === 0 && !working && (
        <div className="mt-1 flex flex-wrap gap-[7px]">
          {ideas.map((idea) => (
            <button key={idea} type="button" onClick={() => setDraft(idea)}
              className="rounded-full border-[1.5px] border-plum-line bg-plum px-[13px] py-[7px] text-left text-[12.5px] font-semibold text-pink">{idea}</button>
          ))}
        </div>
      )}

      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
      <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={2}
          placeholder={working ? "Fo is working on your request…" : "Ask Fo…"} disabled={working}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }}
          className="min-h-11 min-w-0 flex-1 resize-none rounded-[18px] border-[1.5px] border-line bg-card px-4 py-2.5 text-[16px] outline-none disabled:opacity-60" />
        <button type="submit" aria-label="Send to Fo" disabled={working || !draft.trim()}
          className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-[17px] text-ink hover:bg-pink-deep disabled:opacity-60">↑</button>
      </form>
    </Sheet>
  );
}
