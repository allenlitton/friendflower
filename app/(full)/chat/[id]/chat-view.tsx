"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatDetail, Message } from "@/lib/types";
import { Avatar, ComingSoon, ErrorNote, PrimaryButton, SecondaryButton } from "@/components/ui";
import { Sheet } from "@/components/sheet";
import { FriendButton, ReportBlock, useRpc } from "@/components/person-actions";

type VenueRow = { id: string; name: string; kind: string; city_id: string; cities: { short_name: string } };

export function ChatView({ chat, meId, homeCity, initial, venues }: {
  chat: ChatDetail; meId: string; homeCity: string | null; initial: Message[]; venues: VenueRow[];
}) {
  const { call, busy, error, supabase, router } = useRpc();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [intro, setIntro] = useState("");
  const [placeOpen, setPlaceOpen] = useState(false);
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const members = useMemo(() => Object.fromEntries(chat.members.map((m) => [m.id, m])), [chat.members]);
  const venueById = useMemo(() => Object.fromEntries(venues.map((v) => [v.id, v])), [venues]);
  const others = chat.members.filter((m) => !m.is_me);
  const v = chat.verification;
  const mutualMustConfirm = v?.i_am_mutual && v.status === "pending_mutual";

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
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, chat.id, router]);

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
        <Link href="/chats" aria-label="Back" className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-[17px] text-soft">‹</Link>
        <Link href={chat.kind === "direct" && other ? `/people/${other.id}` : "#"} className="flex min-w-0 flex-1 items-center gap-2.5">
          {others[0] && <Avatar id={others[0].id} name={others[0].name} src={chat.kind === "pod" ? null : others[0].avatar_url} size={36} />}
          <div className="min-w-0">
            <div className="truncate font-display text-[20px] leading-[1.1]">{title}</div>
            <div className="truncate text-[11px] text-muted">{presence}</div>
          </div>
        </Link>
        {chat.kind === "direct" && other && (
          <>
            <FriendButton compact personId={other.id} state={{ isFriend: other.is_friend, request: other.friend_request }} />
            <ReportBlock personId={other.id} name={other.first_name} trigger="dots" />
          </>
        )}
        {chat.kind === "pod" && chat.can_post && (
          <button type="button" className="text-[12px] font-semibold text-faint" disabled={busy}
            onClick={async () => { if (confirm("Leave this chat? The other two can keep talking.")) { await call("leave_chat", { p_chat: chat.id }); router.push("/chats"); } }}>
            Leave
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[7px] overflow-y-auto px-[15px] pt-3.5 pb-2">
        {knowNote && (
          <div className="max-w-[88%] self-center rounded-full bg-raised px-3 py-[5px] text-center text-[11px] leading-snug text-[#958d82]">{knowNote}</div>
        )}
        {messages.map((m) => {
          if (m.kind === "system") {
            return <div key={m.id} className="max-w-[90%] self-center rounded-2xl bg-raised px-3 py-[5px] text-center text-[11.5px] leading-snug text-[#958d82]">{m.body}</div>;
          }
          const mine = m.sender_id === meId;
          const sender = m.sender_id ? members[m.sender_id] : null;
          const venue = m.venue_id ? venueById[m.venue_id] : null;
          return (
            <div key={m.id} className={`max-w-[78%] px-[13px] py-2.5 text-[14px] leading-[1.45] ${mine
              ? "self-end rounded-[16px_16px_5px_16px] bg-pink text-white"
              : "self-start rounded-[16px_16px_16px_5px] border-[1.5px] border-[#2f2b27] bg-[#1f1c19] text-text"}`}>
              {chat.kind === "pod" && !mine && sender && <div className="mb-[3px] text-[10.5px] font-bold opacity-70">{sender.first_name}</div>}
              {venue && (
                <Link href={`/places?city=${venue.city_id}`} className={`mb-1 block rounded-lg px-2 py-1.5 text-[12px] font-semibold ${mine ? "bg-white/20" : "bg-well"}`}>
                  📍 {venue.name} · {venue.cities.short_name}
                </Link>
              )}
              {m.body}
            </div>
          );
        })}

        {mutualMustConfirm && (
          <div className="mt-1 rounded-2xl border-[1.5px] border-plum-line bg-plum px-3.5 py-[13px]">
            <div className="text-[13.5px] leading-normal text-[#f3d6df]">
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
              className="rounded-full border-[1.5px] border-gold-line bg-gold-bg px-[13px] py-[7px] text-[12.5px] font-bold whitespace-nowrap text-gold">Let&apos;s meet…</button>
            <button type="button" onClick={() => setPlaceOpen(true)}
              className="rounded-full border-[1.5px] border-leaf-line bg-leaf-bg px-[13px] py-[7px] text-[12.5px] font-semibold whitespace-nowrap text-leaf">Share a place</button>
            <button type="button" onClick={() => setConciergeOpen(true)}
              className="rounded-full border-[1.5px] border-plum-line bg-plum px-[13px] py-[7px] text-[12.5px] font-bold whitespace-nowrap text-pink">Ask concierge</button>
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Say hello…" maxLength={2000}
              className="h-11 min-w-0 flex-1 rounded-full border-[1.5px] border-line bg-card px-4 text-[16px] outline-none" />
            <button type="submit" aria-label="Send" disabled={busy || !draft.trim()}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-pink text-[17px] text-ink hover:bg-pink-deep disabled:opacity-60">↑</button>
          </form>
        </div>
      ) : (
        <div className="flex-none border-t border-line-soft bg-well px-4 py-3 text-center text-[12.5px] text-muted">You left this chat.</div>
      )}

      <Sheet open={placeOpen} onClose={() => setPlaceOpen(false)} title="Share a place">
        <div className="mt-3 flex flex-col gap-1.5">
          {myVenues.map((x) => (
            <button key={x.id} type="button" onClick={() => { setPlaceOpen(false); send(`How about ${x.name}?`, x.id); }}
              className="flex items-center justify-between rounded-xl border-[1.5px] border-line bg-card px-3 py-2.5 text-left">
              <span className="text-[14px] font-semibold">{x.name}</span>
              <span className="text-[11.5px] text-muted capitalize">{x.kind} · {x.cities.short_name}</span>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={conciergeOpen} onClose={() => setConciergeOpen(false)} title="Concierge">
        <div className="mt-3">
          <ComingSoon title="AI concierge">
            Soon the concierge will find a time you&apos;re both free, book the table, and split the bill — right here in the chat.
            For now, use <b>Share a place</b> to suggest somewhere from the list.
          </ComingSoon>
        </div>
      </Sheet>
    </div>
  );
}
