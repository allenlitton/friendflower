"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ErrorNote, PrimaryButton, SectionLabel } from "@/components/ui";
import { Sheet } from "@/components/sheet";

export function useRpc() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function call<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setError(error.message); return undefined; }
    return data as T;
  }
  return { call, busy, error, setError, router, supabase };
}

/** "Say hello": opens (or creates) the 1:1 chat. */
export function SayHello({ personId, className = "", label = "Say hello" }: { personId: string; className?: string; label?: string }) {
  const { call, busy, error, router } = useRpc();
  return (
    <>
      <PrimaryButton className={className} disabled={busy} onClick={async () => {
        const id = await call<string>("open_direct_chat", { p_other: personId });
        if (id) router.push(`/chat/${id}`);
      }}>{label}</PrimaryButton>
      <ErrorNote>{error}</ErrorNote>
    </>
  );
}

export function ChatRailButton({ personId }: { personId: string }) {
  const { call, router } = useRpc();
  return (
    <button type="button" className="flex flex-col items-center gap-[3px]" onClick={async () => {
      const id = await call<string>("open_direct_chat", { p_other: personId });
      if (id) router.push(`/chat/${id}`);
    }}>
      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[11px] border-[1.5px] border-line bg-card text-[14px]">💬</span>
      <span className="text-[10px] font-bold text-soft">chat</span>
    </button>
  );
}

type FriendState = { isFriend: boolean; request?: { id: string; status: string; direction: "sent" | "received" } | null };

/** Add friend / accept / remove. Saved friends appear on your World page. */
export function FriendButton({ personId, state, compact }: { personId: string; state: FriendState; compact?: boolean }) {
  const { call, busy, error, router } = useRpc();
  const received = state.request?.direction === "received" && state.request.status === "pending";
  const sent = state.request?.direction === "sent";
  const label = state.isFriend ? "✓ Friends" : received ? "Accept friend" : sent ? "Requested" : "+ Add friend";
  const cls = compact
    ? `rounded-full px-3 py-1.5 text-[12px] font-bold whitespace-nowrap ${state.isFriend ? "bg-leaf-bg text-leaf" : sent ? "bg-raised text-muted" : "bg-pink text-ink"}`
    : `flex h-[46px] w-full items-center justify-center rounded-[13px] text-[14px] font-bold ${state.isFriend ? "border-[1.5px] border-leaf-line bg-leaf-bg text-leaf" : sent ? "border-[1.5px] border-line bg-card text-muted" : "border-[1.5px] border-plum-line bg-plum text-pink"}`;
  return (
    <>
      <button type="button" className={cls} disabled={busy || sent} onClick={async () => {
        if (state.isFriend) {
          if (!confirm("Remove from your friends? They'll no longer show on your World page.")) return;
          await call("remove_friend", { p_other: personId });
        } else if (received) {
          await call("respond_friend_request", { p_id: state.request!.id, p_accept: true });
        } else {
          await call("add_friend", { p_other: personId });
        }
        router.refresh();
      }}>{label}</button>
      {!compact && <ErrorNote>{error}</ErrorNote>}
    </>
  );
}

const REASONS = [
  { value: "fake_profile", label: "Fake profile" },
  { value: "impersonation", label: "Pretending to be someone" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

/** Report and/or block. Blocking hides you from each other everywhere. */
export function ReportBlock({ personId, name, trigger = "text" }: { personId: string; name: string; trigger?: "text" | "dots" }) {
  const { call, busy, error, router } = useRpc();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(true);
  const [done, setDone] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={trigger === "dots" ? "flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-soft" : "text-[12.5px] font-semibold text-faint"}>
        {trigger === "dots" ? "•••" : "Report or block"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={done ? "Thanks for telling us" : `Report or block ${name}`}>
        {done ? (
          <>
            <p className="mt-3 text-[13.5px] leading-normal text-muted">
              {block ? `${name} can no longer see you or message you, and you won't see them.` : "We'll take a look."} Our team reviews every report.
            </p>
            <PrimaryButton className="mt-4" onClick={() => { setOpen(false); router.push(block ? "/nearby" : "."); router.refresh(); }}>done</PrimaryButton>
          </>
        ) : (
          <>
            <SectionLabel className="mt-4">What&apos;s wrong?</SectionLabel>
            <div className="flex flex-col gap-1.5">
              {REASONS.map((r) => (
                <label key={r.value} className={`flex items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-2.5 text-[14px] ${reason === r.value ? "border-pink" : "border-line"} bg-card`}>
                  <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </div>
            <textarea className="field mt-2.5 !min-h-[70px] !text-[14px]" placeholder="Anything else we should know? (optional)"
              maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
            <label className="mt-2.5 flex items-center gap-2 text-[13px] text-soft">
              <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block {name}
            </label>
            <ErrorNote>{error}</ErrorNote>
            <PrimaryButton className="mt-3.5" disabled={busy || !reason} onClick={async () => {
              const ok = await call("report_user", { p_other: personId, p_reason: reason, p_details: details, p_block: block });
              if (ok !== undefined) setDone(true);
            }}>send report</PrimaryButton>
            <button type="button" disabled={busy} className="mt-3 w-full text-center text-[13px] font-semibold text-pink" onClick={async () => {
              if (!confirm(`Block ${name}? You won't see each other anywhere on Friend Flower.`)) return;
              const ok = await call("block_user", { p_other: personId });
              if (ok !== undefined) { setBlock(true); setDone(true); }
            }}>Just block, don&apos;t report</button>
          </>
        )}
      </Sheet>
    </>
  );
}
