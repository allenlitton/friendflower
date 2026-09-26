"use client";

import Link from "next/link";
import { useState } from "react";
import type { Mini, Profile } from "@/lib/types";
import { Avatar, Flower, PetalHalo, RowLink, SectionLabel, Segmented, Toggle } from "@/components/ui";
import { InviteButton } from "@/components/invite-button";
import { useRpc } from "@/components/person-actions";

export function YouClient({ profile, sub, blocks, contactMatches }: { profile: Profile; sub: string; blocks: Mini[]; contactMatches: number }) {
  const { supabase, router } = useRpc();
  const [p, setP] = useState(profile);

  async function update(patch: Partial<Profile>) {
    setP({ ...p, ...patch });
    await supabase.from("profiles").update(patch).eq("id", p.id);
    router.refresh();
  }

  const toggles = [
    { k: "show_trips" as const, label: "Declared trips", note: "Cities and dates you choose to publish (you can hide any single trip)" },
    { k: "show_online" as const, label: "Online now", note: "Shows the green dot when you've used the app in the last 10 minutes" },
    { k: "show_distance" as const, label: "Show my distance", note: "Off means city-level only — no neighbourhood or distance" },
  ];

  return (
    <div className="flex flex-1 flex-col gap-[15px] overflow-y-auto px-5 pt-2.5 pb-[18px]">
      <div className="flex items-center gap-2">
        <h1 className="font-display text-[31px]">You</h1>
        <Flower />
      </div>

      <div className="flex items-center gap-3.5 rounded-[18px] border-[1.5px] border-line bg-card p-[15px]">
        <PetalHalo size={88}><Avatar id={p.id} name={p.first_name} src={p.avatar_url} size={56} /></PetalHalo>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[23px]">{p.first_name}{p.last_initial ? ` ${p.last_initial}.` : ""}</div>
          <div className="text-[12.5px] leading-snug text-muted">{sub}</div>
          <Link href={`/people/${p.id}`} className="text-[12px] font-semibold text-pink">See how others see you</Link>
        </div>
        <Link href="/you/edit" className="flex-none rounded-full bg-pink px-[13px] py-2 text-[12.5px] font-bold whitespace-nowrap text-ink">Edit profile</Link>
      </div>

      <div>
        <SectionLabel>How you&apos;re found</SectionLabel>
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
          {toggles.map((t, i) => (
            <div key={t.k} className={`flex items-center gap-[11px] px-[15px] py-3 ${i < toggles.length - 1 ? "border-b border-rule" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{t.label}</div>
                <div className="text-[11.5px] leading-snug text-muted">{t.note}</div>
              </div>
              <Toggle label={t.label} on={p[t.k]} onChange={(v) => update({ [t.k]: v })} />
            </div>
          ))}
        </div>
        <div className="mt-2 text-[11.5px] leading-snug text-faint">
          Friend Flower never tracks your location. People only see the city you live in, trips you declare, and — if you add one — your neighbourhood.
        </div>
      </div>

      <div>
        <SectionLabel>Who can see me</SectionLabel>
        <Segmented value={p.visibility} onChange={(v) => update({ visibility: v })}
          options={[{ value: "first", label: "1st only" }, { value: "fof", label: "Friends of friends" }]} />
        <div className="mt-2 text-[12px] leading-snug text-muted">
          {p.visibility === "first"
            ? "Only people you're directly connected to can see you."
            : "Friends and friends of friends can see you. Friends of friends are marked unverified until a mutual friend confirms."}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <RowLink href="/connect" icon="☎" title="Find your friends" note={`${contactMatches} mutual contact match${contactMatches === 1 ? "" : "es"} · sync contacts`} />
        <InviteButton code={p.invite_code} />
      </div>

      <div>
        <SectionLabel>Notifications</SectionLabel>
        <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3 text-[12.5px] leading-snug text-muted">
          Push notifications are coming soon. For now, new messages, friend requests and verification requests show as a pink dot on Chats.
        </div>
      </div>

      {blocks.length > 0 && (
        <div>
          <SectionLabel>Blocked</SectionLabel>
          <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-1">
            {blocks.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-0">
                <Avatar id={b.id} name={b.name} src={b.avatar_url} size={32} />
                <span className="flex-1 text-[14px]">{b.name}</span>
                <button type="button" className="text-[12px] font-semibold text-pink" onClick={async () => {
                  await supabase.from("blocks").delete().eq("blocker_id", p.id).eq("blocked_id", b.id);
                  router.refresh();
                }}>Unblock</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <RowLink href="/privacy" icon="🔒" title="How we handle your data" note="What's shared, with whom, and what's never stored" />
      <a href="mailto:help@friendflower.app" className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3.5 hover:border-[#5a534b]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-plum text-[16px] font-bold text-pink">?</span>
        <div className="min-w-0 flex-1"><div className="text-[14.5px] font-semibold">Need help?</div><div className="text-[11.5px] text-muted">Contact the Friend Flower team</div></div>
        <span className="text-[17px] text-pink">›</span>
      </a>
      <button type="button" className="rounded-[14px] border-[1.5px] border-line bg-card p-[13px] text-[14px] font-semibold text-pink hover:bg-[#241a22]"
        onClick={async () => { await supabase.auth.signOut(); router.replace("/signin"); router.refresh(); }}>
        Sign out
      </button>
    </div>
  );
}
