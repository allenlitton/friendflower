"use client";

import Link from "next/link";
import { useState } from "react";
import type { Person } from "@/lib/types";
import { shortDate } from "@/lib/format";
import { Avatar, ErrorNote, PrimaryButton, SecondaryButton } from "@/components/ui";
import { SayHello, useRpc } from "@/components/person-actions";

type Method = "in_app" | "link" | "self";

/**
 * Mutual-friend verification. Three ways to verify:
 *  - In the app: the other person agrees, then a 3-person chat opens and the
 *    mutual friend taps "Yes, I know them both".
 *  - By link: text the mutual friend a one-tap link (works if they're offline
 *    or not on Friend Flower yet).
 *  - Already checked: you confirmed off the app. Shown with a lighter badge.
 */
export function VerifyPanel({ person: p }: { person: Person }) {
  const { call, busy, error, router } = useRpc();
  const [mutualId, setMutualId] = useState(p.via_kind === "friend" ? p.mutuals[0]?.id ?? "" : "");
  const [mutualName, setMutualName] = useState("");
  const [method, setMethod] = useState<Method | null>(null);
  const [link, setLink] = useState("");

  const v = p.verification;
  const mutual = p.mutuals.find((m) => m.id === mutualId);
  const whoName = mutual?.first_name ?? (mutualName.trim() || "your mutual friend");

  const box = (children: React.ReactNode) => (
    <div className="mt-3.5 rounded-2xl bg-card px-[15px] py-3.5">
      <div className="text-[11.5px] font-bold tracking-[.06em] text-muted uppercase">Verify the link</div>
      {children}
      <ErrorNote>{error}</ErrorNote>
    </div>
  );

  if (p.degree === 1) {
    return box(<>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">You two already know each other directly — nothing to verify.</p>
      <SayHello personId={p.id} className="mt-3 !h-[46px] !text-[19px]" label={`Message ${p.first_name}`} />
    </>);
  }

  if (p.verified) {
    const by = p.verified.by?.first_name;
    return box(<>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">
        {p.verified.method === "self"
          ? `${by} confirmed this off the app with ${p.verified.mutual_name ?? "a mutual friend"}. Self-reported — a mutual friend hasn't confirmed it in the app.`
          : `Verified by ${by}${p.verified.method === "link" ? " (by link)" : ""}. They confirmed they know you both.`}
      </p>
      <SayHello personId={p.id} className="mt-3 !h-[46px] !text-[19px]" label={`Message ${p.first_name}`} />
    </>);
  }

  if (link) {
    const text = `Hi ${whoName}! Can you confirm you know me and ${p.first_name}? It's one tap: ${link}`;
    return box(<>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">
        Send this link to {whoName} by text, WhatsApp or however you usually talk. It works for 7 days and only once.
      </p>
      <div className="mt-2.5 rounded-xl bg-well p-3 text-[12.5px] leading-snug break-all text-soft">{text}</div>
      <PrimaryButton className="mt-3 !h-[46px] !text-[19px]" onClick={async () => {
        if (navigator.share) await navigator.share({ text }).catch(() => {});
        else await navigator.clipboard?.writeText(text);
      }}>share the link</PrimaryButton>
      <a href={`sms:?&body=${encodeURIComponent(text)}`} className="mt-2 block text-center text-[12.5px] font-semibold text-pink">Open in Messages</a>
    </>);
  }

  if (v && (v.status === "pending_target" || v.status === "pending_mutual")) {
    const mName = v.mutual?.first_name ?? v.mutual?.name ?? "your mutual friend";
    if (v.role === "target" && v.status === "pending_target") {
      return box(<>
        <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">
          {p.first_name} asked {mName} to confirm you both know them. If you agree, a chat opens with the three of you.
          Expires {shortDate(v.expires_at.slice(0, 10))}.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SecondaryButton disabled={busy} onClick={async () => { await call("respond_verification", { p_id: v.id, p_accept: false }); router.refresh(); }}>Not now</SecondaryButton>
          <PrimaryButton className="!h-[46px] !text-[19px]" disabled={busy} onClick={async () => {
            const chat = await call<string>("respond_verification", { p_id: v.id, p_accept: true });
            if (chat) router.push(`/chat/${chat}`);
          }}>open the chat</PrimaryButton>
        </div>
      </>);
    }
    return box(<>
      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">
        {v.status === "pending_target"
          ? `Waiting for ${p.first_name} to agree to a chat with ${mName}.`
          : v.method === "link" ? `Waiting for ${mName} to tap the link you sent.`
          : `Waiting for ${mName} to confirm in the chat.`} Requests expire after 7 days.
      </p>
      {v.chat_id && <PrimaryButton href={`/chat/${v.chat_id}`} className="mt-3 !h-[46px] !text-[19px]">open the chat</PrimaryButton>}
      {v.role === "requester" && (
        <button type="button" className="mt-3 w-full text-center text-[12.5px] font-semibold text-faint" disabled={busy}
          onClick={async () => { await call("cancel_verification", { p_id: v.id }); router.refresh(); }}>
          Cancel{v.method === "link" ? " and send a new link" : " this request"}
        </button>
      )}
    </>);
  }

  const lastNote = v?.status === "expired" ? "Your last request expired without an answer — no problem, you can ask again."
    : v?.status === "declined" ? "The last request wasn't confirmed. You can ask someone else." : null;

  async function go(m: Method) {
    if (m === "self" && !confirm(`Confirm you've checked with ${whoName} that they know you both? This is shown as self-reported.`)) return;
    const res = await call<{ id: string; token: string | null }>("request_verification", {
      p_target: p.id, p_method: m, p_mutual: mutualId || null, p_mutual_name: mutualId ? null : mutualName.trim() || null,
    });
    if (!res) return;
    if (m === "link" && res.token) setLink(`${location.origin}/v/${res.token}`);
    else router.refresh();
  }

  const noMutualOnApp = p.via_kind === "school" || p.mutuals.length === 0;

  return box(<>
    <p className="mt-1.5 text-[13.5px] leading-[1.55] text-body">
      {noMutualOnApp
        ? `You're connected through the ${p.via_school ?? "same"} network, not a mutual friend. If you know someone in common, you can still verify through them.`
        : `Ask someone you both know to confirm the connection is real. Nobody sees anyone's contacts.`}
    </p>
    {lastNote && <p className="mt-2 text-[12px] text-faint">{lastNote}</p>}

    {p.mutuals.length > 0 && (
      <div className="mt-3 flex flex-col gap-1.5">
        {p.mutuals.map((m) => (
          <button key={m.id} type="button" onClick={() => setMutualId(m.id)}
            className={`flex items-center gap-2.5 rounded-xl border-[1.5px] bg-well px-3 py-2 text-left ${mutualId === m.id ? "border-pink" : "border-line"}`}>
            <Avatar id={m.id} name={m.name} src={m.avatar_url} size={30} />
            <span className="flex-1 text-[13.5px] font-semibold">{m.name}</span>
            {mutualId === m.id && <span className="text-pink">✓</span>}
          </button>
        ))}
        <button type="button" onClick={() => setMutualId("")}
          className={`rounded-xl border-[1.5px] bg-well px-3 py-2 text-left text-[13px] ${!mutualId ? "border-pink text-text" : "border-line text-muted"}`}>
          Someone else (not on Friend Flower yet)
        </button>
      </div>
    )}
    {!mutualId && (
      <input className="field mt-2" placeholder="Their name, e.g. Priya" value={mutualName} maxLength={60}
        onChange={(e) => setMutualName(e.target.value)} />
    )}

    <div className="mt-3 flex flex-col gap-2">
      {mutualId && (
        <MethodButton on={method === "in_app"} onClick={() => setMethod("in_app")} title={`Ask ${whoName} in the app`}
          note={`${p.first_name} agrees first, then a chat opens with the three of you. ${whoName} taps to confirm.`} />
      )}
      <MethodButton on={method === "link"} onClick={() => setMethod("link")} title={`Text ${whoName} a link`}
        note="Good if they're offline or not on the app yet. They tap once to confirm." />
      <MethodButton on={method === "self"} onClick={() => setMethod("self")} title="I've already checked with them"
        note="You called or messaged them yourself. Shown as self-reported." />
    </div>
    <PrimaryButton className="mt-3 !h-[46px] !text-[19px]" disabled={busy || !method || (!mutualId && !mutualName.trim())}
      onClick={() => method && go(method)}>
      {method === "link" ? "create the link" : method === "self" ? "mark as checked" : `ask ${whoName} to verify`}
    </PrimaryButton>
    <p className="mt-2 text-center text-[11px] text-faint">You can still chat with {p.first_name} before verifying. <Link className="text-pink" href={`/people/${p.id}`}>Back to profile</Link></p>
  </>);
}

function MethodButton({ on, onClick, title, note }: { on: boolean; onClick: () => void; title: string; note: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-xl border-[1.5px] px-3 py-2.5 text-left ${on ? "border-pink bg-plum" : "border-line bg-well"}`}>
      <div className="text-[13.5px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-muted">{note}</div>
    </button>
  );
}
