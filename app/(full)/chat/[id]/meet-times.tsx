"use client";

import { useMemo, useState } from "react";
import type { MeetOptions, MeetPart, MeetState } from "@/lib/types";
import { dayLabel, shortDate, todayISO } from "@/lib/format";
import { PrimaryButton } from "@/components/ui";
import { Sheet } from "@/components/sheet";

export const PARTS: { id: MeetPart; label: string }[] = [
  { id: "morning", label: "Morning" },
  { id: "lunch", label: "Lunch" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Night" },
];
const partLabel = (p: MeetPart) => PARTS.find((x) => x.id === p)?.label ?? p;

/** "You're both in San Francisco · Oct 9 – Oct 14": the days you can actually meet. */
export function MeetNote({ meet, onOpen }: { meet: MeetOptions; onOpen: () => void }) {
  if (meet.runs.length === 0) return null;
  const today = todayISO();
  const parts = meet.runs.slice(0, 2).map((r) => {
    if (r.ongoing && r.from <= today) return `You're both in ${r.short}`;
    const when = r.from <= today ? `until ${shortDate(r.to)}` : r.from === r.to ? shortDate(r.from) : `${shortDate(r.from)} – ${shortDate(r.to)}`;
    return `Both in ${r.short} · ${when}`;
  });
  return (
    <button type="button" onClick={onOpen}
      className="max-w-[92%] self-center rounded-full border-[1.5px] border-leaf-line bg-leaf-bg px-3 py-[5px] text-center text-[13.8px] leading-snug font-semibold text-leaf">
      {parts.join("  ·  ")} · find a time
    </button>
  );
}

/** Tap the times that work for you; they land in the chat as one message. */
export function FindTimeSheet({ open, onClose, meet, busy, onSuggest }: {
  open: boolean; onClose: () => void; meet: MeetOptions; busy: boolean;
  onSuggest: (slots: { day: string; part: MeetPart }[]) => Promise<boolean>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setPicked((prev) => { const n = new Set(prev); if (!n.delete(k)) n.add(k); return n; });

  return (
    <Sheet open={open} onClose={onClose} title="Find a time">
      {meet.days.length === 0 ? (
        <p className="mt-3 text-[16.2px] leading-normal text-muted">
          You two aren&apos;t in the same city in the next 60 days. When either of you adds a trip, the days you overlap show up here.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-[15.6px] leading-normal text-muted">
            Tap the times that work for you. They go to the chat for them to tap too, and the ones you both pick are your time.
          </p>
          <div className="mt-3 flex flex-col gap-2.5">
            {meet.days.map((d) => (
              <div key={d.day}>
                <div className="mb-1 flex items-baseline justify-between text-[15px]">
                  <span className="font-semibold">{dayLabel(d.day)}</span>
                  <span className="text-muted">{d.short}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {PARTS.map((p) => {
                    const on = picked.has(`${d.day}|${p.id}`);
                    return (
                      <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(`${d.day}|${p.id}`)}
                        className={`rounded-xl border-[1.5px] px-1 py-2 text-[14.4px] font-semibold ${on
                          ? "border-leaf-line bg-leaf-bg text-leaf" : "border-line bg-card text-soft"}`}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <PrimaryButton className="mt-4 !h-[48px] !text-[19px]" disabled={busy || picked.size === 0}
            onClick={async () => {
              const slots = [...picked].map((k) => { const [day, part] = k.split("|"); return { day, part: part as MeetPart }; });
              if (await onSuggest(slots)) { setPicked(new Set()); onClose(); }
            }}>
            {picked.size === 0 ? "pick some times" : `suggest ${picked.size} time${picked.size === 1 ? "" : "s"}`}
          </PrimaryButton>
        </>
      )}
    </Sheet>
  );
}

/** A suggested-times message: tap a time to say it works, tap again to take it back. */
export function TimesCard({ state, meId, memberIds, mine, onPick }: {
  state: MeetState | undefined; meId: string; memberIds: string[]; mine: boolean;
  onPick: (messageId: number, day: string, part: MeetPart, on: boolean) => void;
}) {
  const today = todayISO();
  const byDay = useMemo(() => {
    const m = new Map<string, MeetState["options"]>();
    for (const o of state?.options ?? []) m.set(o.day, [...(m.get(o.day) ?? []), o]);
    return [...m.entries()];
  }, [state]);
  if (!state) return <div className="text-[15.6px] opacity-80">Suggested times…</div>;

  const works = (o: MeetState["options"][number]) => memberIds.every((id) => o.by.includes(id));
  const matches = state.options.filter((o) => works(o) && o.day >= today);
  const city = state.options[0]?.city;

  return (
    <div className="min-w-[230px]">
      <div className="text-[15.6px] font-bold">Times to meet{city ? ` · ${city}` : ""}</div>
      <div className="mt-2 flex flex-col gap-2">
        {byDay.map(([day, opts]) => (
          <div key={day}>
            <div className={`mb-1 text-[13.8px] font-semibold ${mine ? "text-white/80" : "text-muted"}`}>{dayLabel(day)}</div>
            <div className="flex flex-wrap gap-1.5">
              {opts.map((o) => {
                const me = o.by.includes(meId);
                const both = works(o);
                const past = o.day < today;
                return (
                  <button key={o.part} type="button" disabled={past} aria-pressed={me}
                    onClick={() => onPick(state.message_id, o.day, o.part, !me)}
                    className={`rounded-full border-[1.5px] px-[11px] py-[5px] text-[14.4px] font-semibold disabled:opacity-40 ${both
                      ? "border-leaf-line bg-leaf-bg text-leaf"
                      : me ? "border-gold-line bg-gold-bg text-gold" : "border-line bg-well text-soft"}`}>
                    {both ? "✓ " : ""}{partLabel(o.part)}
                    <span className="ml-1 opacity-70">{o.by.length}/{memberIds.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className={`mt-2.5 text-[14.4px] leading-snug ${mine ? "text-white/90" : "text-muted"}`}>
        {matches.length > 0
          ? <b>You both can: {matches.slice(0, 3).map((o) => `${dayLabel(o.day)} ${partLabel(o.part).toLowerCase()}`).join(" · ")}</b>
          : "Tap the times that work for you."}
      </div>
    </div>
  );
}
