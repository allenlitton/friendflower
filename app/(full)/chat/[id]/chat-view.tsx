"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatDetail, MeetOptions, MeetPart, MeetState, Message } from "@/lib/types";
import { Avatar, ErrorNote, PrimaryButton, SecondaryButton } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { FriendButton, ReportBlock, useRpc } from "@/components/person-actions";
import { FindTimeSheet, MeetNote, TimesCard } from "./meet-times";

const TRASH_W = 48;

type VenueRow = { id: string; name: string; kind: string; city_id: string; cities: { short_name: string } };

export function ChatView({ chat, meId, homeCity, initial, venues, meet, initialTimes, initialDraft = "" }: {
  chat: ChatDetail; meId: string; homeCity: string | null; initial: Message[]; venues: VenueRow[];
  meet: MeetOptions | null; initialTimes: MeetState[]; initialDraft?: string;
}) {
  const { call, busy, error, supabase, router } = useRpc();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState(initialDraft);
  const [intro, setIntro] = useState("");
  const [placeOpen, setPlaceOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [times, setTimes] = useState(initialTimes);
  // Swipe-left on your own message reveals a trash can: `open` is the revealed row, `drag` the live offset.
  const [open, setOpen] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; dx: number } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; locked: boolean } | null>(null);
  const swiped = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);

  const members = useMemo(() => Object.fromEntries(chat.members.map((m) => [m.id, m])), [chat.members]);
  const venueById = useMemo(() => Object.fromEntries(venues.map((v) => [v.id, v])), [venues]);
  const others = chat.members.filter((m) => !m.is_me);
  const v = chat.verification;
  const mutualMustConfirm = v?.i_am_mutual && v.status === "pending_mutual";

  const timesById = useMemo(() => Object.fromEntries(times.map((t) => [t.message_id, t])), [times]);
  const activeIds = chat.members.filter((m) => !m.left).map((m) => m.id);
  const loadTimes = useCallback(async () => {
    const { data } = await supabase.rpc("meet_state", { p_chat: chat.id });
    if (data) setTimes(data as MeetState[]);
  }, [supabase, chat.id]);

  // Live updates: new messages arrive over Supabase Realtime (same privacy rules apply).
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${chat.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          supabase.rpc("mark_read", { p_chat: chat.id });
          if (m.kind === "system") router.refresh();
          if (m.kind === "times") loadTimes();
        })
      // Someone tapping a suggested time touches its message, so both screens update.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `chat_id=eq.${chat.id}` },
        (payload) => { if ((payload.new as Message).kind === "times") loadTimes(); })
      // Deletes carry only the id (no chat_id), so they can't be filtered; unknown ids are ignored.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = (payload.old as { id?: number }).id;
          if (id) setMessages((prev) => prev.filter((x) => x.id !== id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, chat.id, router, loadTimes]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length]);

  async function send(body: string, venueId?: string) {
    const text = body.trim();
    if (!text) return;
    const id = await call<number>("send_message", { p_chat: chat.id, p_body: text, p_venue: venueId ?? null });
    if (id) {
      setDraft("");
      // Realtime usually delivers it too; this makes it appear instantly either way.
      setMessages((prev) => prev.some((x) => x.id === id) ? prev : [...prev, {
        id, chat_id: chat.id, sender_id: meId, kind: venueId ? "venue" : "text", body: text, venue_id: venueId ?? null, created_at: new Date().toISOString(),
      }]);
    }
  }

  async function remove(id: number) {
    setOpen(null);
    const before = messages;
    setMessages((prev) => prev.filter((x) => x.id !== id));
    const ok = await call("delete_message", { p_message: id });
    if (ok === undefined) setMessages(before);
  }

  async function suggest(slots: { day: string; part: MeetPart }[]) {
    const id = await call<number>("propose_times", { p_chat: chat.id, p_slots: slots });
    if (!id) return false;
    await loadTimes();
    setMessages((prev) => prev.some((x) => x.id === id) ? prev : [...prev, {
      id, chat_id: chat.id, sender_id: meId, kind: "times", body: "Suggested times to meet", venue_id: null, created_at: new Date().toISOString(),
    }]);
    return true;
  }

  async function pickTime(messageId: number, day: string, part: MeetPart, on: boolean) {
    // Show the tap straight away; the database has the final say.
    setTimes((prev) => prev.map((t) => t.message_id !== messageId ? t : {
      ...t, options: t.options.map((o) => o.day !== day || o.part !== part ? o
        : { ...o, by: on ? [...o.by.filter((u) => u !== meId), meId] : o.by.filter((u) => u !== meId) }),
    }));
    await call("pick_time", { p_message: messageId, p_day: day, p_part: part, p_on: on });
    loadTimes();
  }

  const other = chat.other;
  const title = chat.kind === "pod" ? others.map((m) => m.first_name).join(" · ") : other?.name ?? others[0]?.name;
  const presence = chat.kind === "pod"
    ? `Verification chat${v?.status === "confirmed" ? " · verified ✓" : v?.status === "pending_mutual" ? ` · waiting for ${v.mutual?.first_name}` : ""}`
    : other?.online ? "online" : other?.degree === 1 ? "1st degree" : other?.via ? `2nd degree · via ${other.via}` : other?.via_school ? `2nd degree · ${other.via_school}` : "";
  const knowNote = chat.kind === "pod"
    ? `${v?.mutual?.first_name ?? "Your mutual friend"} can confirm you both really know them. Nobody sees anyone's contacts.`
    : other?.degree === 1 ? "You know each other directly."
    : other?.via ? `You know each other through ${other.via}${other.verified ? " · verified ✓" : " · not verified yet"}`
    : other?.via_school ? `You're both in the ${other.via_school} network` : "";
  const myVenues = venues.filter((x) => x.city_id === homeCity).length ? venues.filter((x) => x.city_id === homeCity) : venues;

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ height: "100dvh" }}>
      <div className="flex flex-none items-center gap-[11px] border-b border-line-soft bg-well px-3.5 py-[9px]">
        <Link href="/chats" aria-label="Back" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-[20.4px] text-soft">‹</Link>
        <Link href={chat.kind === "direct" && other ? `/people/${other.id}` : "#"} className="flex min-w-0 flex-1 items-center gap-2.5">
          {others[0] && <Avatar id={others[0].id} name={others[0].name} src={chat.kind === "pod" ? null : others[0].avatar_url} size={36} />}
          <div className="min-w-0">
            <div className="truncate font-display text-[20px] leading-[1.1]">{title}</div>
            <div className="truncate text-[13.2px] text-muted">{presence}</div>
          </div>
        </Link>
        {chat.kind === "direct" && other && (
          <>
            <FriendButton compact personId={other.id} state={{ isFriend: other.is_friend, request: other.friend_request }} />
            <ReportBlock personId={other.id} name={other.first_name} trigger="dots" />
          </>
        )}
        {chat.kind === "pod" && chat.can_post && (
          <button type="button" className="text-[14.4px] font-semibold text-faint" disabled={busy}
            onClick={async () => { if (confirm("Leave this chat? The other two can keep talking.")) { await call("leave_chat", { p_chat: chat.id }); router.push("/chats"); } }}>
            Leave
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto px-[15px] pt-3.5 pb-2">
        {knowNote && (
          <div className="max-w-[88%] self-center rounded-full bg-raised px-3 py-[5px] text-center text-[13.2px] leading-snug text-[#958d82]">{knowNote}</div>
        )}
        {meet && chat.can_post && <MeetNote meet={meet} onOpen={() => setTimeOpen(true)} />}
        {messages.map((m) => {
          if (m.kind === "system") {
            return <div key={m.id} className="max-w-[90%] self-center rounded-2xl bg-raised px-3 py-[5px] text-center text-[13.8px] leading-snug text-[#958d82]">{m.body}</div>;
          }
          const mine = m.sender_id === meId;
          const sender = m.sender_id ? members[m.sender_id] : null;
          const venue = m.venue_id ? venueById[m.venue_id] : null;
          return (
            <div key={m.id} className={`flex max-w-[78%] items-center gap-1.5 ${mine ? "self-end" : "self-start"}`}>
              <div
                {...(mine ? {
                  onPointerDown: (e: React.PointerEvent) => {
                    gesture.current = { id: m.id, x: e.clientX, y: e.clientY, locked: false };
                    swiped.current = false;
                  },
                  onPointerMove: (e: React.PointerEvent) => {
                    const g = gesture.current;
                    if (!g || g.id !== m.id) return;
                    const dx = e.clientX - g.x;
                    if (!g.locked) {
                      if (Math.abs(e.clientY - g.y) > 10 && Math.abs(e.clientY - g.y) > Math.abs(dx)) { gesture.current = null; return; }
                      if (Math.abs(dx) < 8) return;
                      g.locked = true;
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    }
                    setDrag({ id: m.id, dx: Math.max(-TRASH_W, Math.min(0, dx + (open === m.id ? -TRASH_W : 0))) });
                  },
                  onPointerUp: () => {
                    const g = gesture.current; gesture.current = null;
                    if (!g?.locked) return;
                    swiped.current = true;
                    setOpen((drag?.dx ?? 0) < -TRASH_W / 2 ? m.id : null);
                    setDrag(null);
                  },
                  onPointerCancel: () => { gesture.current = null; setDrag(null); },
                  onClick: () => { if (!swiped.current && open === m.id) setOpen(null); swiped.current = false; },
                } : {})}
                style={mine ? {
                  touchAction: "pan-y",
                  transform: `translateX(${drag?.id === m.id ? drag.dx : open === m.id ? -TRASH_W : 0}px)`,
                  transition: drag?.id === m.id ? "none" : "transform 160ms ease-out",
                } : undefined}
                className={`min-w-0 px-[13px] py-2.5 text-[16.8px] leading-[1.45] select-none ${mine
                  ? "rounded-[16px_16px_5px_16px] bg-pink text-white"
                  : "rounded-[16px_16px_16px_5px] border-[1.5px] border-[#2f2b27] bg-[#1f1c19] text-text"}`}>
              {chat.kind === "pod" && !mine && sender && <div className="mb-[3px] text-[12.6px] font-bold opacity-70">{sender.first_name}</div>}
              {venue && (
                <Link href={`/places?city=${venue.city_id}`} className={`mb-1 block rounded-lg px-2 py-1.5 text-[14.4px] font-semibold ${mine ? "bg-white/20" : "bg-well"}`}>
                  📍 {venue.name} · {venue.cities.short_name}
                </Link>
              )}
              {m.kind === "times"
                ? <TimesCard state={timesById[m.id]} meId={meId} memberIds={activeIds} mine={mine} onPick={pickTime} />
                : m.body}
              </div>
              {mine && (
                <button type="button" aria-label="Delete message" disabled={busy} onClick={() => remove(m.id)}
                  style={{ marginLeft: -TRASH_W, width: 40, opacity: open === m.id || drag?.id === m.id ? 1 : 0, pointerEvents: open === m.id ? "auto" : "none", transition: "opacity 160ms" }}
                  className="flex h-10 flex-none items-center justify-center rounded-full bg-[#3a1d24] text-[#ff8a9b]">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                  </svg>
                </button>
              )}
            </div>
          );
        })}

        {mutualMustConfirm && (
          <div className="mt-1 rounded-2xl border-[1.5px] border-plum-line bg-plum px-3.5 py-[13px]">
            <div className="text-[16.2px] leading-normal text-[#f3d6df]">
              Do you know <b>{v!.requester.first_name}</b> and <b>{v!.target.first_name}</b>? Confirming marks them as verified on both profiles.
            </div>
            <textarea className="field mt-2.5 !min-h-[64px] !bg-well !text-[14px]" maxLength={500} value={intro} onChange={(e) => setIntro(e.target.value)}
              placeholder={`Add an intro (optional) — e.g. "${v!.target.first_name}, meet ${v!.requester.first_name}: you'll get on."`} />
            <div className="mt-2.5 grid grid-cols-[1fr_1.4fr] gap-2">
              <SecondaryButton disabled={busy} onClick={async () => {
                if (!confirm("Say you can't confirm this connection?")) return;
                await call("confirm_verification", { p_id: v!.id, p_confirm: false }); router.refresh();
              }}>I don&apos;t know them</SecondaryButton>
              <PrimaryButton className="!h-[46px] !text-[18px]" disabled={busy} onClick={async () => {
                await call("confirm_verification", { p_id: v!.id, p_confirm: true, p_intro: intro }); setIntro(""); router.refresh();
              }}>yes, I know them both</PrimaryButton>
            </div>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div ref={bottom} />
      </div>

      {chat.can_post ? (
        <div className="flex flex-none flex-col gap-2 border-t border-line-soft bg-well px-[13px] pt-2 pb-[calc(13px+env(safe-area-inset-bottom))]">
          <div className="flex gap-[7px] overflow-x-auto">
            <button type="button" onClick={() => send("Let's meet — I'm free most evenings this week.")}
              className="rounded-full border-[1.5px] border-gold-line bg-gold-bg px-[13px] py-[7px] text-[15px] font-bold whitespace-nowrap text-gold">Let&apos;s meet…</button>
            {meet && (
              <button type="button" onClick={() => setTimeOpen(true)}
                className="rounded-full border-[1.5px] border-leaf-line bg-leaf-bg px-[13px] py-[7px] text-[15px] font-semibold whitespace-nowrap text-leaf">Find a time</button>
            )}
            <button type="button" onClick={() => setPlaceOpen(true)}
              className="rounded-full border-[1.5px] border-leaf-line bg-leaf-bg px-[13px] py-[7px] text-[15px] font-semibold whitespace-nowrap text-leaf">Share a place</button>
            <Link href={`/fo?draft=${encodeURIComponent(`Book a table for me and ${others.filter((m) => !m.left).map((m) => m.first_name).join(" and ") || "a friend"}`)}`}
              className="rounded-full border-[1.5px] border-plum-line bg-plum px-[13px] py-[7px] text-[15px] font-bold whitespace-nowrap text-pink">Ask Fo Concierge</Link>
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say hello…" maxLength={2000}
              className="h-11 min-w-0 flex-1 rounded-full border-[1.5px] border-line bg-card px-4 text-[19.2px] outline-none" />
            <button type="submit" aria-label="Send" disabled={busy || !draft.trim()}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-[20.4px] text-ink hover:bg-pink-deep disabled:opacity-60">↑</button>
          </form>
        </div>
      ) : (
        <div className="flex-none border-t border-line-soft bg-well px-4 py-3 text-center text-[15px] text-muted">You left this chat.</div>
      )}

      {meet && <FindTimeSheet open={timeOpen} onClose={() => setTimeOpen(false)} meet={meet} busy={busy} onSuggest={suggest} />}
      <Sheet open={placeOpen} onClose={() => setPlaceOpen(false)} title="Share a place">
        <div className="mt-3 flex flex-col gap-1.5">
          {myVenues.map((x) => (
            <button key={x.id} type="button" onClick={() => { setPlaceOpen(false); send(`How about ${x.name}?`, x.id); }}
              className="flex items-center justify-between rounded-xl border-[1.5px] border-line bg-card px-3 py-2.5 text-left">
              <span className="text-[16.8px] font-semibold">{x.name}</span>
              <span className="text-[13.8px] text-muted capitalize">{x.kind} · {x.cities.short_name}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
