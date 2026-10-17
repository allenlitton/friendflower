import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/session";
import type { Person } from "@/lib/types";
import { dateRange } from "@/lib/format";
import { Avatar, BackBar, PetalHalo } from "@/components/ui";
import { VerifyPanel } from "./verify-panel";

export default async function HowPage({ params }: PageProps<"/people/[id]/how">) {
  const { id } = await params;
  const { supabase, profile } = await requireProfile();
  const { data } = await supabase.rpc("person", { p_id: id });
  const p = data as Person | null;
  if (!p || p.is_me) notFound();

  const via = p.degree === 2 && p.via_kind === "friend" ? p.mutuals[0] : null;
  const evidence = [
    ...(p.mutuals.length ? [{ icon: "❋", bg: "#c98da3", title: `${p.mutuals.length} mutual friend${p.mutuals.length === 1 ? "" : "s"}`, note: p.mutuals.map((m) => m.name).join(", ") }] : []),
    ...(p.via_kind === "school" ? [{ icon: "C", bg: "#8ec9a1", title: `${p.via_school} network`, note: "Same school, within a year of each other" }] : []),
    ...(p.shared_schools ?? []).filter((s) => s !== p.via_school).map((s) => ({ icon: "C", bg: "#8ec9a1", title: `Both went to ${s}`, note: "School overlap" })),
    ...(p.shared_places ?? []).map((c) => ({ icon: "🏠", bg: "#e0b070", title: `Both lived in ${c}`, note: "From your city histories" })),
    ...(p.trip_overlaps ?? []).map((t) => ({ icon: "✈", bg: "#e0b070", title: `${t.city}, ${dateRange(t.from, t.to)}`, note: "Your trips overlap" })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BackBar href={`/people/${p.id}`} title={<span className="text-[13.8px] font-bold tracking-[.06em] text-muted uppercase font-sans">{p.degree === 1 ? "1st" : "2nd"} degree connection</span>} />
      <div className="flex-1 overflow-y-auto px-[22px] pt-1 pb-[18px]">
        <h1 className="mt-2 font-display text-[35px] leading-[1.15]">
          {p.degree === 1 ? "You already know each other" : "You know each other from…"}
        </h1>
        <div className="mt-1.5 text-[15.6px] text-muted">
          {p.degree === 1 ? `A direct friend · ${p.mutuals.length} mutuals in common` : via ? "One person stands between you" : "You share a network"}
        </div>

        <div className="mt-[22px] mb-1.5 flex flex-col items-center">
          <Node id={profile.id} name={profile.first_name} src={profile.avatar_url} label="You" />
          <Dash />
          {via && (
            <>
              <Node id={via.id} name={via.name} src={via.avatar_url} label={via.name} />
              <Dash />
            </>
          )}
          {p.via_kind === "school" && (
            <>
              <div className="rounded-full bg-leaf-bg px-3 py-1.5 text-[14.4px] font-bold text-leaf">{p.via_school}</div>
              <Dash />
            </>
          )}
          <Node id={p.id} name={p.name} src={p.avatar_url} label={p.first_name} />
        </div>

        <div className="mt-[18px] flex flex-col gap-2">
          {evidence.map((e, i) => (
            <div key={i} className="flex items-center gap-[11px] rounded-[15px] border-[1.5px] border-line bg-card px-3.5 py-3">
              <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[10px] text-[13.2px] font-bold text-white" style={{ background: e.bg }}>{e.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[16.2px] font-semibold">{e.title}</div>
                <div className="text-[13.8px] leading-snug text-muted">{e.note}</div>
              </div>
            </div>
          ))}
        </div>

        <VerifyPanel person={p} />
      </div>
    </div>
  );
}

function Node({ id, name, src, label }: { id: string; name: string; src: string | null; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <PetalHalo size={94}><Avatar id={id} name={name} src={src} size={60} /></PetalHalo>
      <div className="text-[15px] font-bold text-soft">{label}</div>
    </div>
  );
}

function Dash() {
  return <div className="h-[26px] w-0.5 bg-[repeating-linear-gradient(180deg,#dcbcd4_0_5px,transparent_5px_10px)]" />;
}
