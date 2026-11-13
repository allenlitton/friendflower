"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote } from "@/components/ui";
import Link from "next/link";
import { FoFace } from "@/components/fo-face";
import { MessageBox } from "@/components/message-box";

export type FoAction = {
  id: number; body: string; status: "pending" | "sent" | "dismissed"; chat_id: string | null;
  friend: { id: string; first_name: string; name: string; avatar_url: string | null };
};
export type FoMessage = { id: number; role: "me" | "fo"; body: string; created_at: string; actions?: FoAction[] };
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

  // Fo can't cancel a request, so this frees the chat; a message sent afterwards
  // goes to Fo as an update to the one that was stopped.
  async function stop() {
    setError("");
    shown.current = false; // end the current wait; follow() restarts it for the next request
    setSending(false);
    setThread((t) => ({ ...t, status: "idle", progress: null }));
    await fetch("/api/fo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat: chatId, page, stop: true }) }).catch(() => {});
    shown.current = true;
    await load();
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || (sending && !working)) return;
    if (working) await stop();
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
    // Exactly one screen tall (below the status bar), so only the messages scroll and the header stays put.
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top))] min-h-0 flex-col">
      <div className="flex flex-none items-center gap-[11px] border-b border-line-soft bg-well px-3.5 py-[9px]">
        <Link href="/chats" aria-label="Back" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-[20.4px] text-soft">‹</Link>
        <FoFace size={36} />
        <div className="min-w-0">
          <div className="truncate font-display text-[20px] leading-[1.1]">Fo Concierge</div>
          <div className="truncate text-[13.2px] text-muted">Your concierge · only you see this chat</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto px-4 py-3.5">
        {thread.messages.length === 0 && (
          <p className="px-2 py-4 text-center text-[15.6px] leading-normal text-muted">
            Fo Concierge finds the place, books the table, and sorts flights and deliveries.
          </p>
        )}
        {thread.messages.map((m) => (
          <div key={m.id} className={`flex max-w-[85%] flex-col gap-1.5 ${m.role === "me" ? "self-end" : "self-start"}`}>
            <div className={`px-[13px] py-2.5 text-[16.8px] leading-[1.45] whitespace-pre-wrap ${m.role === "me"
              ? "rounded-[16px_16px_5px_16px] bg-pink text-white"
              : "rounded-[16px_16px_16px_5px] border-[1.5px] border-plum-line bg-plum text-[#f3d6df]"}`}>
              {m.body}
            </div>
            {m.actions?.map((a) => <DraftCard key={a.id} action={a} onDone={load} />)}
          </div>
        ))}
        {working && (
          <div className="self-start rounded-2xl bg-raised px-3 py-2 text-[15px] leading-snug text-muted" role="status">
            <span className="animate-pulse">✦</span> {thread.progress ?? "Fo Concierge is on it…"}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <div className="flex-none border-t border-line-soft bg-well px-3.5 pt-2.5 pb-[calc(16px+env(safe-area-inset-bottom))]">
        {thread.messages.length === 0 && !working && (
          <div className="mb-2.5 flex flex-wrap gap-[7px]">
            {ideas.map((idea) => (
              <button key={idea} type="button" onClick={() => setDraft(idea)}
                className="rounded-full border-[1.5px] border-plum-line bg-plum px-[13px] py-[7px] text-left text-[15px] font-semibold text-pink">{idea}</button>
            ))}
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <MessageBox value={draft} onChange={setDraft} onSend={() => send(draft)}
            placeholder={working ? "Add more, or stop Fo Concierge…" : "Ask Fo Concierge…"} />
          {working && !draft.trim() ? (
            <button type="button" onClick={stop} aria-label="Stop Fo Concierge"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-ink hover:bg-pink-deep">
              <span className="h-3.5 w-3.5 rounded-[3px] bg-ink" />
            </button>
          ) : (
            <button type="submit" aria-label={working ? "Stop Fo Concierge and send" : "Send to Fo Concierge"} disabled={!draft.trim()}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-[20.4px] text-ink hover:bg-pink-deep disabled:opacity-60">↑</button>
          )}
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

/** A Friend Flower message Fo drafted. Nothing goes out until you tap Send. */
function DraftCard({ action, onDone }: { action: FoAction; onDone: () => Promise<unknown> }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: "fo_send_action" | "fo_dismiss_action") {
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc(fn, { p_action: action.id });
    if (error) setError(error.message);
    await onDone();
    setBusy(false);
  }
  return (
    <div className="rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-3">
      <div className="text-[13.2px] font-bold tracking-[.05em] text-muted uppercase">Message to {action.friend.first_name}</div>
      <div className="mt-1.5 text-[16.8px] leading-[1.45] whitespace-pre-wrap text-body">{action.body}</div>
      <ErrorNote>{error}</ErrorNote>
      {action.status === "pending" ? (
        <div className="mt-2.5 flex gap-2">
          <button type="button" disabled={busy} onClick={() => run("fo_send_action")}
            className="rounded-full bg-pink px-3.5 py-2 text-[15px] font-bold text-ink hover:bg-pink-deep disabled:opacity-60">Send to {action.friend.first_name}</button>
          <button type="button" disabled={busy} onClick={() => run("fo_dismiss_action")}
            className="rounded-full px-3 py-2 text-[15px] font-semibold text-faint disabled:opacity-60">Don&apos;t send</button>
        </div>
      ) : action.status === "sent" ? (
        <div className="mt-2 text-[15px] text-leaf">
          Sent ✓ {action.chat_id && <Link href={`/chat/${action.chat_id}`} className="ml-1 font-semibold text-pink">Open chat</Link>}
        </div>
      ) : (
        <div className="mt-2 text-[15px] text-faint">Not sent</div>
      )}
    </div>
  );
}
