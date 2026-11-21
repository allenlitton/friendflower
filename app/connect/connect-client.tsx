"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseVCard } from "@/lib/vcard";
import { hasNativeContacts, readNativeContacts } from "@/lib/native-contacts";
import type { Mini } from "@/lib/types";
import { Avatar, Card, ErrorNote, Flower, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { InviteButton } from "@/components/invite-button";
import { FindFriend } from "@/components/find-friend";

type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ tel?: string[]; email?: string[] }[]> };

const noSubscribe = () => () => {};

export function ConnectClient({ welcome, inviteCode, myName, stats, suggestions }: {
  welcome: boolean; inviteCode: string; myName: string;
  stats: { uploaded: number; matches: number; has_phone: boolean };
  suggestions: Mini[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checked: number; on_app: number; new_matches: number } | null>(null);
  const [error, setError] = useState("");
  const [typed, setTyped] = useState("");
  const [added, setAdded] = useState<Record<string, string>>({});
  // Inside the iPhone app we read the address book directly; Android Chrome has a picker; everything else uploads a file.
  const native = useSyncExternalStore(noSubscribe, hasNativeContacts, () => false);
  const browserPicker = typeof navigator !== "undefined" && "contacts" in navigator;
  const canPick = native || browserPicker;
  // Right after someone creates their profile in the iPhone app, a pop-up asks to sync contacts.
  const [promptClosed, setPromptClosed] = useState(false);
  const showPrompt = welcome && native && stats.uploaded === 0 && !result && !promptClosed;

  async function send(values: string[]) {
    if (!values.length) return setError("We didn't find any phone numbers or emails there.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/contacts", { method: "POST", body: JSON.stringify({ contacts: values }) });
      const json = await res.json();
      if (!res.ok) return setError(json.error);
      setResult(json);
      router.refresh();
    } catch {
      setError("We couldn't reach Friend Flower. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    if (native) {
      try {
        const res = await readNativeContacts();
        if (!res.ok) return setError("Friend Flower doesn't have access to your contacts. Turn it on in Settings → Friend Flower → Contacts, or upload a contacts file below.");
        await send(res.values);
      } catch {
        setError("We couldn't read your contacts. Try again, or upload a contacts file below.");
      }
      return;
    }
    try {
      const picked = await (navigator as unknown as { contacts: ContactsManager }).contacts.select(["tel", "email"], { multiple: true });
      await send(picked.flatMap((c) => [...(c.tel ?? []), ...(c.email ?? [])]));
    } catch {
      /* cancelled */
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await send(parseVCard(await file.text()));
  }

  async function addFriend(id: string) {
    const { data, error } = await supabase.rpc("add_friend", { p_other: id });
    if (error) return setError(error.message);
    setAdded({ ...added, [id]: data as string });
  }

  async function wipe() {
    if (!confirm("Delete all the contacts you've uploaded? Matches that came from them will be removed.")) return;
    await supabase.rpc("delete_my_contacts");
    setResult(null);
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-col gap-3.5">
      {showPrompt && (
        <ContactSyncPrompt busy={busy} error={error} onSync={pick}
          onClose={() => { setPromptClosed(true); setError(""); }} />
      )}
      <FindFriend inviteCode={inviteCode} myName={myName} />
      <Card className="p-[15px]">
        <div className="flex items-center gap-3">
          <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[11px] bg-[#8a8f6b] text-[16.8px] font-bold">☎</span>
          <div className="flex-1">
            <div className="text-[17.4px] font-semibold">Contacts</div>
            <div className="text-[13.8px] text-muted">Matched on phone number or email only</div>
          </div>
        </div>
        <p className="mt-3 text-[15px] leading-normal text-muted">
          Numbers and emails are scrambled into codes on our server, and the originals are thrown away. Nobody — including us —
          can see your contact list, and it&apos;s never shown to other people.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {canPick && <PrimaryButton onClick={pick} disabled={busy}>{busy ? "matching…" : native ? "find friends in my contacts" : "choose from contacts"}</PrimaryButton>}
          <label className={`flex h-[46px] cursor-pointer items-center justify-center rounded-[13px] text-[14px] font-semibold ${canPick ? "border-[1.5px] border-line bg-card text-soft" : "bg-pink font-display !text-[21px] text-ink"}`}>
            {busy && !canPick ? "matching…" : "upload a contacts file (.vcf)"}
            <input type="file" accept=".vcf,text/vcard,text/x-vcard" className="hidden" onChange={upload} disabled={busy} />
          </label>
          {!canPick && (
            <details className="text-[13.8px] leading-normal text-faint">
              <summary className="cursor-pointer text-pink">How do I export my contacts on iPhone?</summary>
              Open the Contacts app → tap <b>Lists</b> (top left) → press and hold <b>All Contacts</b> → <b>Export</b> →
              save the file, then upload it here. On a Mac: Contacts → select all → File → Export → Export vCard.
            </details>
          )}
          <textarea className="field !min-h-[70px] !text-[14px]" placeholder="Or type a few numbers or emails, one per line"
            value={typed} onChange={(e) => setTyped(e.target.value)} />
          {typed.trim() && (
            <SecondaryButton onClick={() => send(typed.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)).then(() => setTyped(""))} disabled={busy}>
              Check these
            </SecondaryButton>
          )}
        </div>
        <ErrorNote>{error}</ErrorNote>
        {result && (
          <div className="mt-3 rounded-xl bg-leaf-bg px-3 py-2.5 text-[15px] leading-normal text-leaf">
            Checked {result.checked} contacts · {result.on_app} on Friend Flower · {result.new_matches} new mutual match
            {result.new_matches === 1 ? "" : "es"}.
            {result.on_app > result.new_matches && " People who don't have your number yet appear below — add them as friends."}
          </div>
        )}
        {(stats.uploaded > 0 || result) && (
          <div className="mt-3 flex items-center justify-between text-[13.8px] text-faint">
            <span>{stats.matches} mutual contact matches</span>
            <button type="button" onClick={wipe} className="font-semibold text-faint underline">Delete my uploaded contacts</button>
          </div>
        )}
        {!stats.has_phone && (
          <div className="mt-3 text-[13.8px] leading-normal text-faint">
            Tip: add your phone number in <a href="/you/edit">Edit profile</a> so friends who have it can find you.
          </div>
        )}
      </Card>

      {suggestions.length > 0 && (
        <div>
          <SectionLabel>In your contacts</SectionLabel>
          <Card className="px-3.5 py-1">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-rule py-2.5 last:border-0">
                <Avatar id={s.id} name={s.name} src={s.avatar_url} size={40} />
                <div className="flex-1 text-[17.4px] font-semibold">{s.name}</div>
                <button type="button" onClick={() => addFriend(s.id)} disabled={!!added[s.id]}
                  className="rounded-full bg-pink px-3 py-1.5 text-[15px] font-bold text-ink disabled:bg-leaf-bg disabled:text-leaf">
                  {added[s.id] === "accepted" ? "Friends" : added[s.id] ? "Requested" : "Add friend"}
                </button>
              </div>
            ))}
          </Card>
        </div>
      )}

      <div>
        <SectionLabel>Invite friends</SectionLabel>
        <InviteButton code={inviteCode} />
      </div>

      {welcome && <PrimaryButton href="/nearby" className="mt-2">{result || stats.uploaded ? "see who's nearby" : "skip for now"}</PrimaryButton>}
    </div>
  );
}

/**
 * The pop-up bubble shown once, right after a new person saves their profile in the iPhone app,
 * asking to sync their contacts so mutual friends can be matched. iOS's own permission prompt follows.
 */
function ContactSyncPrompt({ busy, error, onSync, onClose }: {
  busy: boolean; error: string; onSync: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,5,4,.6)] px-6 backdrop-blur-[2px]"
      onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal aria-labelledby="sync-title"
        className="relative w-full max-w-[360px] rounded-[22px] border-[1.5px] border-plum-line bg-[rgba(42,31,39,.92)] px-[22px] pt-6 pb-5 text-center shadow-[0_12px_40px_rgba(0,0,0,.5)] backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full text-[15px] text-plum-text hover:bg-white/10 hover:text-white">
          ✕
        </button>
        <div className="flex justify-center"><Flower size={44} /></div>
        <h2 id="sync-title" className="mt-3 font-display text-[28px] leading-[1.1]">Find friends you already know</h2>
        <p className="mt-2.5 text-[15.6px] leading-normal text-[#f3d6df]">
          Sync your contacts and we&apos;ll match you with people who have each other&apos;s number — that&apos;s where the
          mutual friend magic happens.
        </p>
        <p className="mt-2.5 text-[13.8px] leading-normal text-plum-text">
          🔒 Private: only phone numbers and emails are read, scrambled into codes, and the originals thrown away.
          Nobody — including us — can see your contacts.
        </p>
        {error && <div className="mt-3 text-left"><ErrorNote>{error}</ErrorNote></div>}
        <PrimaryButton className="mt-4" onClick={onSync} disabled={busy}>{busy ? "matching…" : "sync my contacts"}</PrimaryButton>
        <button type="button" onClick={onClose} disabled={busy}
          className="mt-2 h-10 w-full text-[15px] font-semibold text-plum-text hover:text-white">
          not now
        </button>
      </div>
    </div>
  );
}
