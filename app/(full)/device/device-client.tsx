"use client";

import { useState } from "react";
import { PrimaryButton, SectionLabel } from "@/components/ui";
import { useRpc } from "@/components/person-actions";

export type Device = { id: string; name: string; created_at: string; last_seen_at: string | null };

const seen = (at: string | null) => {
  if (!at) return "Not connected yet";
  const mins = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (mins < 2) return "Connected now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  return `Last seen ${new Date(at).toLocaleString()}`;
};

export function DeviceClient({ devices, initialCode }: { devices: Device[]; initialCode: string }) {
  const { call, busy, error, router } = useRpc();
  const [code, setCode] = useState(initialCode);
  const [message, setMessage] = useState("");

  async function link() {
    setMessage("");
    const res = await call<{ ok: boolean; error?: string }>("claim_device", { p_code: code });
    if (!res) return;
    if (!res.ok) { setMessage(res.error ?? "That code didn't work."); return; }
    setCode("");
    setMessage("Linked! Your device will show your Friend Flower in a few seconds.");
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Remove this device? It will stop showing your Friend Flower until you link it again.")) return;
    await call("remove_device", { p_id: id });
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-[18px] pb-6">
      <div>
        <SectionLabel>Link a device</SectionLabel>
        <p className="mb-3 text-[13px] leading-normal text-body">
          Type the 6-letter code shown on your round Friend Flower device.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); link(); }} className="flex flex-col gap-2.5">
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={9}
            autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABC123"
            className="h-[54px] rounded-[14px] border-[1.5px] border-line bg-card px-4 text-center font-display text-[30px] tracking-[.25em] outline-none focus:border-pink" />
          <PrimaryButton type="submit" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 6}>link device</PrimaryButton>
        </form>
        {(message || error) && <div className="mt-2 text-[13px] leading-snug text-pink">{message || error}</div>}
      </div>

      {devices.length > 0 && (
        <div>
          <SectionLabel>Your devices</SectionLabel>
          <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 border-b border-rule px-[15px] py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold">{d.name}</div>
                  <div className="text-[11.5px] text-muted">{seen(d.last_seen_at)}</div>
                </div>
                <button type="button" onClick={() => remove(d.id)} disabled={busy}
                  className="text-[12.5px] font-semibold text-pink">Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[12px] leading-snug text-muted">
            The device shows your Nearby, Chats, Trips and Places — only what you can already see here.
          </div>
        </div>
      )}
    </div>
  );
}
