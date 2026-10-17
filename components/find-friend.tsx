"use client";

import Link from "next/link";
import { useState } from "react";
import type { Mini } from "@/lib/types";
import { Avatar, ErrorNote, PrimaryButton } from "@/components/ui";
import { FriendButton } from "@/components/person-actions";

type Result =
  | { status: "found"; person: Mini; is_friend: boolean; request: { id: string; status: string; direction: "sent" | "received" } | null; kind: string; normalised: string }
  | { status: "not_found" | "self" | "limit"; kind: "email" | "phone"; normalised: string };

/** Search by email or phone. Add them if they're here; invite them if not. */
export function FindFriend({ inviteCode, myName }: { inviteCode: string; myName: string }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    const res = await fetch("/api/find", { method: "POST", body: JSON.stringify({ query }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    setResult(json);
  }

  const inviteUrl = typeof window === "undefined" ? "" : `${location.origin}/invite/${inviteCode}`;
  const inviteText = `Hey! I'm using Friend Flower to keep track of where friends are and meet friends of friends. Join me: ${inviteUrl}`;
  const inviteHref = result?.status === "not_found"
    ? result.kind === "email"
      ? `mailto:${result.normalised}?subject=${encodeURIComponent(`${myName} invited you to Friend Flower`)}&body=${encodeURIComponent(inviteText)}`
      : `sms:${result.normalised}?&body=${encodeURIComponent(inviteText)}`
    : "";

  return (
    <div id="find" className="rounded-[18px] border-[1.5px] border-line bg-card p-[15px]">
      <div className="text-[17.4px] font-semibold">Find a friend</div>
      <div className="mt-0.5 text-[13.8px] leading-snug text-muted">
        Search by their email or phone number. If they&apos;re not on Friend Flower yet, you can invite them.
      </div>
      <form onSubmit={search} className="mt-3 flex gap-2">
        <input className="field min-w-0 flex-1" placeholder="Email or phone number" autoComplete="off" autoCapitalize="none"
          value={query} onChange={(e) => { setQuery(e.target.value); setResult(null); }} />
        <button type="submit" disabled={busy || query.trim().length < 5}
          className="h-12 flex-none rounded-[13px] bg-pink px-4 text-[16.8px] font-bold text-ink disabled:opacity-45">
          {busy ? "…" : "Search"}
        </button>
      </form>
      <ErrorNote>{error}</ErrorNote>

      {result?.status === "found" && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-well px-3 py-2.5">
          <Link href={`/people/${result.person.id}`}><Avatar id={result.person.id} name={result.person.name} src={result.person.avatar_url} size={42} /></Link>
          <Link href={`/people/${result.person.id}`} className="min-w-0 flex-1 text-[17.4px] font-semibold">{result.person.name}</Link>
          <FriendButton compact personId={result.person.id} state={{ isFriend: result.is_friend, request: result.request }} />
        </div>
      )}
      {result?.status === "not_found" && (
        <div className="mt-3 rounded-2xl bg-well px-3 py-3">
          <div className="text-[15.6px] leading-snug text-body">
            <b>{result.normalised}</b> isn&apos;t on Friend Flower yet. Send them your invite — when they join, you&apos;ll be friends automatically.
          </div>
          <PrimaryButton href={inviteHref} className="mt-2.5 !h-[46px] !text-[19px]">
            {result.kind === "email" ? "invite by email" : "invite by text"}
          </PrimaryButton>
        </div>
      )}
      {result?.status === "self" && <div className="mt-3 text-[15.6px] text-muted">That&apos;s you!</div>}
      {result?.status === "limit" && (
        <div className="mt-3 text-[15.6px] text-muted">You&apos;ve done a lot of searches today — try again tomorrow, or share your invite link below.</div>
      )}
    </div>
  );
}
