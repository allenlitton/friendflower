"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { parseVCard } from "@/lib/vcard";
import type { Mini } from "@/lib/types";
import { Avatar, Card, ErrorNote, PrimaryButton, SecondaryButton, SectionLabel } from "@/components/ui";
import { InviteButton } from "@/components/invite-button";
import { FindFriend } from "@/components/find-friend";

type ContactsManager = { select: (props: string[], opts: { multiple: boolean }) => Promise<{ tel?: string[]; email?: string[] }[]> };

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
  const canPick = typeof navigator !== "undefined" && "contacts" in navigator;

  async function send(values: string[]) {
    if (!values.length) return setError("We didn't find any phone numbers or emails there.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/contacts", { method: "POST", body: JSON.stringify({ contacts: values }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error);
    setResult(json);
    router.refresh();
  }

  async function pick() {
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
          {canPick && <PrimaryButton onClick={pick} disabled={busy}>{busy ? "matching…" : "choose from contacts"}</PrimaryButton>}
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
