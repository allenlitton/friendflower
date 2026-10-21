"use client";

import { useEffect, useState } from "react";
import type { Units } from "@/lib/types";
import { ErrorNote, SectionLabel, Segmented, Toggle } from "@/components/ui";
import { useRpc } from "@/components/person-actions";
import { disablePush, enablePush, hasNativePush, openIosSettings, pushState, type PushState } from "@/lib/native-push";

// Only English for now; the rest are shown so people know they're coming.
const LANGUAGES = ["English", "Español", "Français", "Deutsch", "Português", "Italiano", "日本語", "中文", "한국어"];

export type FoSharing = { on: boolean; email: string | null; phone: string | null };
export type PushPrefs = { messages: boolean; friend_requests: boolean; badge: boolean };

const PUSH_CHOICES: { key: keyof PushPrefs; label: string }[] = [
  { key: "messages", label: "New messages" },
  { key: "friend_requests", label: "Friend requests" },
  { key: "badge", label: "Unread count on app icon" },
];

export function SettingsClient({ profileId, units: initialUnits, foSharing, signInEmail, pushPrefs }: {
  profileId: string; units: Units; foSharing: FoSharing; signInEmail: string; pushPrefs: PushPrefs;
}) {
  const { supabase, router, call, busy, error } = useRpc();
  const [units, setUnits] = useState(initialUnits);
  const [fo, setFo] = useState({ on: foSharing.on, email: foSharing.email ?? "", phone: foSharing.phone ?? "" });
  const [foSaved, setFoSaved] = useState(foSharing);

  async function saveFo(next: typeof fo) {
    const ok = await call("set_fo_sharing", { p_on: next.on, p_email: next.email, p_phone: next.phone });
    if (ok === undefined) return;
    setFoSaved({ on: next.on, email: next.on ? next.email.trim().toLowerCase() || null : null, phone: next.on ? next.phone.trim() || null : null });
    if (!next.on) setFo({ on: false, email: "", phone: "" });
  }
  const foDirty = fo.on && ((fo.email.trim().toLowerCase() || null) !== foSaved.email || (fo.phone.trim() || null) !== foSaved.phone);

  // Notifications only exist in the iPhone app; null until we've asked iOS (and always on the website).
  const [push, setPush] = useState<PushState | null>(null);
  useEffect(() => {
    if (hasNativePush()) pushState().then(setPush).catch(() => {});
  }, []);

  const [prefs, setPrefs] = useState(pushPrefs);
  async function changePref(key: keyof PushPrefs, on: boolean) {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    const ok = await call("set_push_prefs", { p_messages: next.messages, p_friend_requests: next.friend_requests, p_badge: next.badge });
    if (ok === undefined) setPrefs(prefs);
  }

  async function changePush(on: boolean) {
    if (on) setPush((await enablePush((url) => router.push(url))) ? "on" : await pushState());
    else {
      setPush("off");
      await disablePush(true);
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteWord, setDeleteWord] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError("");
    const res = await fetch("/api/account/delete", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      setDeleting(false);
      setDeleteError((await res?.json().catch(() => null))?.error ?? "Couldn't reach the server. Try again.");
      return;
    }
    await supabase.auth.signOut();
    router.replace("/signin");
    router.refresh();
  }

  async function changeUnits(u: Units) {
    setUnits(u);
    await supabase.from("profiles").update({ units: u }).eq("id", profileId);
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-[18px] pb-6">
      <div>
        <SectionLabel>Units</SectionLabel>
        <Segmented value={units} onChange={changeUnits}
          options={[{ value: "imperial", label: "Imperial (mi, ft)" }, { value: "metric", label: "Metric (km, m)" }]} />
        <div className="mt-2 text-[14.4px] leading-snug text-muted">Used for live distances on Nearby and profiles.</div>
      </div>

      {push && (
        <div>
          <SectionLabel>Notifications</SectionLabel>
          <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[16.8px] font-semibold">Push notifications</span>
              <Toggle label="Push notifications" on={push === "on"} onChange={changePush} />
            </div>
            <div className="mt-1.5 text-[14.4px] leading-snug text-muted">
              {push === "blocked"
                ? "Notifications are turned off for Friend Flower in your iPhone's Settings app. Turn them on there, then come back."
                : "Get a ping on this phone for new messages and friend requests."}
            </div>
            {push === "on" && (
              <div className="mt-3 border-t border-rule">
                {PUSH_CHOICES.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-0">
                    <span className="flex-1 text-[15.6px]">{label}</span>
                    <Toggle label={label} on={prefs[key]} onChange={(on) => changePref(key, on)} />
                  </div>
                ))}
                {!fo.on && <ErrorNote>{error}</ErrorNote>}
              </div>
            )}
            {push !== "off" && (
              <button type="button" onClick={openIosSettings} className="mt-3 text-[15px] font-bold text-pink underline">
                {push === "blocked" ? "Open iPhone Settings" : "Banners, sounds and lock screen"}
              </button>
            )}
          </div>
          {push === "on" && (
            <div className="mt-2 text-[14.4px] leading-snug text-muted">
              How notifications look (banners, sounds, showing on the lock screen) is set in your iPhone&apos;s Settings app.
            </div>
          )}
        </div>
      )}

      <div>
        <SectionLabel>Fo Concierge</SectionLabel>
        <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex-1 text-[16.8px] font-semibold">Share with my friends&apos; Fo Concierge</span>
            <Toggle label="Share with my friends' Fo Concierge" on={fo.on} onChange={(on) => {
              const next = { ...fo, on };
              setFo(next);
              saveFo(next);
            }} />
          </div>
          <div className="mt-1.5 text-[14.4px] leading-snug text-muted">
            When a friend asks Fo Concierge for help, Fo Concierge can see where you are (your city, your neighbourhood if you show distance, and
            trips they can see) and reach you on the email or phone below. Never your live position. Off by default.
          </div>
          {fo.on && (
            <div className="mt-3 flex flex-col gap-2.5">
              <input className="field" type="email" inputMode="email" autoComplete="email" maxLength={200} value={fo.email}
                placeholder={signInEmail ? `Email (optional), e.g. ${signInEmail}` : "Email (optional)"}
                onChange={(e) => setFo({ ...fo, email: e.target.value })} />
              <input className="field" type="tel" inputMode="tel" autoComplete="tel" maxLength={25} value={fo.phone}
                placeholder="Phone for texts (optional), e.g. +1 415 555 0100"
                onChange={(e) => setFo({ ...fo, phone: e.target.value })} />
              <ErrorNote>{error}</ErrorNote>
              {foDirty && (
                <button type="button" disabled={busy} onClick={() => saveFo(fo)}
                  className="self-start rounded-full bg-pink px-4 py-2 text-[15px] font-bold text-ink hover:bg-pink-deep disabled:opacity-60">Save</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Account</SectionLabel>
        <div className="rounded-2xl border-[1.5px] border-line bg-card px-[15px] py-3.5">
          <div className="text-[14.4px] leading-snug text-muted">
            Deleting your account permanently removes your profile, photos, messages, friends, trips, contact codes and location.
            This can&apos;t be undone.
          </div>
          {!confirmDelete ? (
            <button type="button" onClick={() => setConfirmDelete(true)} className="mt-3 text-[15px] font-bold text-pink underline">
              Delete my account
            </button>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              <input className="field" value={deleteWord} onChange={(e) => setDeleteWord(e.target.value)} autoCapitalize="characters"
                placeholder="Type DELETE to confirm" />
              <ErrorNote>{deleteError}</ErrorNote>
              <div className="flex gap-2">
                <button type="button" disabled={deleting || deleteWord.trim().toUpperCase() !== "DELETE"} onClick={deleteAccount}
                  className="rounded-full bg-pink px-4 py-2 text-[15px] font-bold text-ink hover:bg-pink-deep disabled:opacity-60">
                  {deleting ? "deleting…" : "Delete forever"}
                </button>
                <button type="button" disabled={deleting} onClick={() => { setConfirmDelete(false); setDeleteWord(""); setDeleteError(""); }}
                  className="rounded-full border-[1.5px] border-line px-4 py-2 text-[15px] font-semibold text-soft">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Language</SectionLabel>
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
          {LANGUAGES.map((l, i) => (
            <div key={l} className="flex items-center gap-[11px] border-b border-rule px-[15px] py-3 last:border-0">
              <span className={`flex-1 text-[16.8px] font-semibold ${i === 0 ? "" : "text-faint"}`}>{l}</span>
              {i === 0
                ? <span className="text-[18px] font-bold text-pink">✓</span>
                : <span className="rounded-full bg-gold-bg px-1.5 py-px text-[11.4px] font-bold text-gold">soon</span>}
            </div>
          ))}
        </div>
        <div className="mt-2 text-[14.4px] leading-snug text-muted">Friend Flower is English-only for now. More languages are on the way.</div>
      </div>
    </div>
  );
}
