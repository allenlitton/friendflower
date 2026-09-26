"use client";

import Link from "next/link";
import type { Inbox } from "@/lib/types";
import { Avatar, ErrorNote } from "@/components/ui";
import { useRpc } from "@/components/person-actions";

export function InboxActions({ inbox }: { inbox: Inbox }) {
  const { call, busy, error, router } = useRpc();
  const btn = "rounded-full px-3 py-1.5 text-[12px] font-bold whitespace-nowrap";

  return (
    <div className="flex flex-col gap-2">
      {inbox.friend_requests.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-3 py-2.5">
          <Link href={`/people/${r.from.id}`}><Avatar id={r.from.id} name={r.from.name} src={r.from.avatar_url} size={40} /></Link>
          <div className="min-w-0 flex-1 text-[13px] leading-snug"><b>{r.from.name}</b> wants to add you as a friend</div>
          <button type="button" className={`${btn} bg-raised text-muted`} disabled={busy}
            onClick={async () => { await call("respond_friend_request", { p_id: r.id, p_accept: false }); router.refresh(); }}>✕</button>
          <button type="button" className={`${btn} bg-pink text-ink`} disabled={busy}
            onClick={async () => { await call("respond_friend_request", { p_id: r.id, p_accept: true }); router.refresh(); }}>Accept</button>
        </div>
      ))}
      {inbox.verifications.map((v) => (
        <div key={v.id} className="rounded-2xl border-[1.5px] border-plum-line bg-plum px-3 py-2.5">
          <div className="text-[13px] leading-snug text-[#f3d6df]">
            {v.role === "target"
              ? <><b>{v.requester.name}</b> asked <b>{v.mutual?.name}</b> to confirm you both know them. Open a chat with the three of you?</>
              : <><b>{v.requester.name}</b> asked you to confirm you know them and <b>{v.target.name}</b>.</>}
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {v.role === "target" ? (
              <>
                <button type="button" className={`${btn} bg-raised text-muted`} disabled={busy}
                  onClick={async () => { await call("respond_verification", { p_id: v.id, p_accept: false }); router.refresh(); }}>Not now</button>
                <button type="button" className={`${btn} bg-pink text-ink`} disabled={busy}
                  onClick={async () => { const chat = await call<string>("respond_verification", { p_id: v.id, p_accept: true }); if (chat) router.push(`/chat/${chat}`); }}>Open chat</button>
              </>
            ) : (
              <Link href={`/chat/${v.chat_id}`} className={`${btn} bg-pink text-ink`}>Open chat</Link>
            )}
          </div>
        </div>
      ))}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
