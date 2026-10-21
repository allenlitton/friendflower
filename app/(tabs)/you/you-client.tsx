"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import type { Mini, Profile } from "@/lib/types";
import { Avatar, Flower, PetalHalo, RowLink, SectionLabel, Segmented, Toggle } from "@/components/ui";
import { InviteButton } from "@/components/invite-button";
import { useRpc } from "@/components/person-actions";
import { turnOnLiveDistance } from "@/components/live-location";
import { disablePush, hasNativePush } from "@/lib/native-push";

const noSubscribe = () => () => {};

export function YouClient({ profile, sub, blocks, contactMatches }: { profile: Profile; sub: string; blocks: Mini[]; contactMatches: number }) {
  const { supabase, router } = useRpc();
  const [p, setP] = useState(profile);
  const [liveError, setLiveError] = useState<string | null>(null);
  // Push only works in the iPhone app. False on the server, so the first render matches.
  const inApp = useSyncExternalStore(noSubscribe, hasNativePush, () => false);

  async function update(patch: Partial<Profile>) {
    setP({ ...p, ...patch });
    await supabase.from("profiles").update(patch).eq("id", p.id);
    router.refresh();
  }

  async function setLive(on: boolean) {
    setLiveError(null);
    if (!on) return update({ share_live_location: false });
    setP({ ...p, share_live_location: true });
    const err = await turnOnLiveDistance(supabase, p.id);
    if (err) { setP({ ...p, share_live_location: false }); setLiveError(err); }
    router.refresh();
  }

  const toggles = [
    { k: "show_trips" as const, label: "Declared trips", note: "Cities and dates you choose to publish (you can hide any single trip)" },
    { k: "show_online" as const, label: "Online now", note: "Shows the green dot when you've used the app in the last 10 minutes" },
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
          <div className="text-[15px] leading-snug text-muted">{sub}</div>
          <Link href={`/people/${p.id}`} className="text-[14.4px] font-semibold text-pink">See how others see you</Link>
        </div>
        <Link href="/you/edit" className="flex-none rounded-full bg-pink px-[13px] py-2 text-[15px] font-bold whitespace-nowrap text-ink">Edit profile</Link>
      </div>

      <div>
        <SectionLabel>How you&apos;re found</SectionLabel>
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
          {toggles.map((t) => (
            <div key={t.k} className="flex items-center gap-[11px] border-b border-rule px-[15px] py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="text-[16.8px] font-semibold">{t.label}</div>
                <div className="text-[13.8px] leading-snug text-muted">{t.note}</div>
              </div>
              <Toggle label={t.label} on={p[t.k]} onChange={(v) => update({ [t.k]: v })} />
            </div>
          ))}
          <div className="flex items-center gap-[11px] px-[15px] py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[16.8px] font-semibold">Live distance</div>
              <div className="text-[13.8px] leading-snug text-muted">
                While the app is open, people in your circle who share theirs see how far away you are, to {p.units === "metric" ? "about 150 m" : "0.1 mi"}
              </div>
              {liveError && <div className="mt-1 text-[13.8px] leading-snug text-plum-text">{liveError}</div>}
            </div>
            <Toggle label="Live distance" on={p.share_live_location} onChange={setLive} />
          </div>
        </div>
        <div className="mt-2 text-[13.8px] leading-snug text-faint">
          People see the city you live in, trips you declare, and — if you add one — your neighbourhood. With live distance on,
          they see how far away you are, never where you are.
        </div>
      </div>

      <div>
        <SectionLabel>Who can see me</SectionLabel>
        <Segmented value={p.visibility} onChange={(v) => update({ visibility: v })}
          options={[{ value: "first", label: "1st only" }, { value: "fof", label: "Friends of friends" }]} />
        <div className="mt-2 text-[14.4px] leading-snug text-muted">
          {p.visibility === "first"
            ? "Only people you're directly connected to can see you."
            : "Friends and friends of friends can see you. Friends of friends are marked unverified until a mutual friend confirms."}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <RowLink href="/connect" icon="☎" title="Find your friends" note={`Search by email or phone, sync contacts · ${contactMatches} contact match${contactMatches === 1 ? "" : "es"}`} />
        <InviteButton code={p.invite_code} />
      </div>

      <div>
        <SectionLabel>Notifications</SectionLabel>
        {inApp ? (
          <RowLink href="/you/settings" icon="🔔" title="Push notifications" note="New messages and friend requests on this phone" />
        ) : (
          <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3 text-[15px] leading-snug text-muted">
            Push notifications come with the Friend Flower iPhone app. Here, new messages, friend requests and verification requests show as a pink flower on Chats.
          </div>
        )}
      </div>

      {blocks.length > 0 && (
        <div>
          <SectionLabel>Blocked</SectionLabel>
          <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-1">
            {blocks.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-0">
                <Avatar id={b.id} name={b.name} src={b.avatar_url} size={32} />
                <span className="flex-1 text-[16.8px]">{b.name}</span>
                <button type="button" className="text-[14.4px] font-semibold text-pink" onClick={async () => {
                  await supabase.from("blocks").delete().eq("blocker_id", p.id).eq("blocked_id", b.id);
                  router.refresh();
                }}>Unblock</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <RowLink href="/you/settings" icon="⚙" title="Settings" note="Language and units" />
      <RowLink href="/privacy" icon="🔒" title="How we handle your data" note="What's shared, with whom, and what's never stored" />
      <RowLink href="/terms" icon="📄" title="Terms of use" note="The rules for being here" />
      <a href="mailto:hello@friendflower.app" className="flex items-center gap-3 rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3.5 hover:border-[#5a534b]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-plum text-[19.2px] font-bold text-pink">?</span>
        <div className="min-w-0 flex-1"><div className="text-[17.4px] font-semibold">Need help?</div><div className="text-[13.8px] text-muted">Contact the Friend Flower team</div></div>
        <span className="text-[20.4px] text-pink">›</span>
      </a>
      <button type="button" className="rounded-[14px] border-[1.5px] border-line bg-card p-[13px] text-[16.8px] font-semibold text-pink hover:bg-[#241a22]"
        onClick={async () => { await disablePush(); await supabase.auth.signOut(); router.replace("/signin"); router.refresh(); }}>
        Sign out
      </button>
    </div>
  );
}
