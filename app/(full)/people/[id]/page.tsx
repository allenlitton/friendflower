import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/session";
import type { Person } from "@/lib/types";
import { dateRange, farLabel, gradientFor, initials, nearbyLabel, shortDate } from "@/lib/format";
import { SectionLabel, PrimaryButton, Tag } from "@/components/ui";
import { ChatRailButton, FriendButton, ReportBlock, SayHello } from "@/components/person-actions";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  const { supabase } = await requireProfile();
  const { data } = await supabase.rpc("person", { p_id: id });
  const p = data as Person | null;
  if (!p) notFound();

  const degShort = p.is_me ? "you" : p.degree === 1 ? "1°" : "2°";
  const nextTrip = p.trips.find((t) => t.starts_on > (p.now?.until ?? ""));
  const flightsTrip = p.trip_overlaps?.[0];

  // Approximate distance: neighbourhood-to-neighbourhood in the same city,
  // city-to-city otherwise. Never an exact location.
  const where = p.now ? (p.now.neighbourhood ? `${p.now.neighbourhood}, ${p.now.short}` : p.now.city) : null;
  const distance =
    p.distance_kind === "nearby" ? { icon: "📍", big: `${nearbyLabel(p.distance_mi)} away`, small: where }
    : p.distance_kind === "far" ? { icon: "✈", big: `${farLabel(p.distance_mi)} away`, small: p.now?.city ?? null }
    : p.distance_kind === "same_city" ? { icon: "📍", big: `Also in ${p.now?.city}`, small: "Add a neighbourhood to your profile to see how close" }
    : where ? { icon: "📍", big: p.is_me ? `In ${where}` : where, small: null } : null;
  const railDistance = p.distance_kind === "nearby" ? nearbyLabel(p.distance_mi)?.replace("~", "")
    : p.distance_kind === "far" ? farLabel(p.distance_mi) : null;

  const mutualLine = p.degree === 1
    ? `${p.mutuals.length} mutual${p.mutuals.length === 1 ? "" : "s"} · you know each other directly`
    : p.via_kind === "school" ? `Via the ${p.via_school} network`
    : `${p.mutuals.length} mutual${p.mutuals.length === 1 ? "" : "s"} · via ${p.mutuals[0]?.name}`;

  const cities = [
    ...(p.now ? [{ glyph: "📍", city: p.now.city, years: p.now.presence === "visiting" ? `until ${shortDate(p.now.until)}` : "now" }] : []),
    ...(p.home && p.now?.presence === "visiting" ? [{ glyph: "🏠", city: p.home.city, years: "based" }] : []),
    ...p.trips.filter((t) => t.city_id !== p.now?.city_id || p.now?.presence !== "visiting")
      .map((t) => ({ glyph: "✈", city: t.city, years: dateRange(t.starts_on, t.ends_on) })),
    ...p.places.map((pl) => ({ glyph: "🏠", city: pl.city, years: pl.kind === "grew_up" ? `grew up${pl.years ? ` · ${pl.years}` : ""}` : pl.years ?? "lived" })),
  ];
  const schoolLine = p.schools.map((s) => `${s.name} ’${String(s.grad_year).slice(-2)}`).join(" · ");
  const idLine = [p.hometown, p.age].filter(Boolean).join(", ");

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left rail, as in the design: city, next trip, how you're connected, chat. */}
      <div className="flex w-16 flex-none flex-col items-center gap-3.5 border-r border-line-soft bg-card pt-3 pb-4">
        <Link href={p.is_me ? "/you" : "/nearby"} aria-label="Back"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] border-line bg-card text-[17px] text-soft">‹</Link>
        <RailItem glyph="📍" label={p.now?.short ?? "—"} sub={railDistance} />
        <RailItem glyph="✈" label={nextTrip?.city ?? "—"} />
        {!p.is_me && (
          <Link href={`/people/${p.id}/how`} className="flex flex-col items-center gap-[3px]">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-pink text-[12px] font-bold text-ink">{degShort}</span>
            <span className="text-[10px] font-bold text-pink">how</span>
          </Link>
        )}
        <div className="flex-1" />
        {p.is_me ? (
          <Link href="/you/edit" className="flex flex-col items-center gap-[3px]">
            <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[11px] bg-pink text-[14px] font-bold text-ink">✎</span>
            <span className="text-[10px] font-bold text-pink">edit</span>
          </Link>
        ) : <ChatRailButton personId={p.id} />}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="relative h-[220px]" style={{ background: gradientFor(p.id) }}>
          {p.avatar_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={p.avatar_url} alt="" className="absolute inset-0 h-full w-full bg-white object-cover" />
            : <div className="absolute inset-0 flex items-center justify-center font-display text-[62px] text-white/90">{initials(p.name)}</div>}
          {p.online && !p.is_me && (
            <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10.5px] font-bold text-[#2c7a45]">
              <span className="h-[7px] w-[7px] rounded-full bg-online" />online
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3.5 px-[18px] pt-3.5 pb-[18px]">
          {p.is_me && (
            <div className="rounded-xl border-[1.5px] border-plum-line bg-plum px-3 py-2 text-[12px] leading-snug text-plum-text">
              This is how friends and friends of friends see your profile.
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[32px] leading-[1.05]">{p.name}</h1>
              {p.verified && <Tag tone={p.verified.method === "self" ? "grey" : "leaf"}>✓ verified</Tag>}
            </div>
            {(schoolLine || idLine) && (
              <div className="mt-1 text-[13px] leading-normal text-muted">{[schoolLine, idLine].filter(Boolean).join(" · ")}</div>
            )}
          </div>

          {distance && (
            <div className="flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-line bg-card px-[13px] py-2.5">
              <span className="text-[15px]">{distance.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{distance.big}</div>
                {distance.small && <div className="text-[11.5px] text-muted">{distance.small}</div>}
              </div>
              {p.now?.presence === "visiting" && !p.is_me && (
                <span className="rounded-full bg-gold-bg px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap text-gold">until {shortDate(p.now.until)}</span>
              )}
            </div>
          )}

          {flightsTrip && (
            <div className="flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-plum-line bg-plum px-[13px] py-[11px]">
              <span className="text-[14px] text-pink">✈</span>
              <span className="text-[13px] leading-snug font-semibold text-[#f3d6df]">
                You&apos;re both in {flightsTrip.city} {dateRange(flightsTrip.from, flightsTrip.to)}
              </span>
            </div>
          )}

          {!p.is_me && (
            <Link href={`/people/${p.id}/how`} className="flex items-center gap-[11px] rounded-2xl border-[1.5px] border-line bg-card px-3.5 py-3 hover:border-[#5a534b]">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-plum text-[11.5px] font-bold text-pink">{degShort}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{mutualLine}</div>
                <div className="text-[11.5px] text-muted">
                  {p.degree === 2 && !p.verified ? "Not verified yet · tap to see how you know each other" : "Tap to see how you know each other"}
                </div>
              </div>
              <span className="text-[17px] text-pink">›</span>
            </Link>
          )}

          {p.bio && <p className="text-[14.5px] leading-[1.55] text-body">{p.bio}</p>}

          {cities.length > 0 && (
            <div>
              <SectionLabel>Cities</SectionLabel>
              <div className="flex flex-col gap-1.5">
                {cities.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13.5px]">
                    <span className="w-4 flex-none text-center text-muted">{c.glyph}</span>
                    <span className="font-semibold">{c.city}</span>
                    <span className="text-muted">{c.years}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {p.spots.length > 0 && (
            <div>
              <SectionLabel>Where they&apos;d take you</SectionLabel>
              <div className="flex flex-wrap gap-[7px]">
                {p.spots.map((s) => (
                  <span key={s} className="rounded-full border-[1.5px] border-line bg-card px-3 py-[7px] text-[12.5px] font-semibold text-body">{s}</span>
                ))}
              </div>
            </div>
          )}

          {p.languages.length > 0 && (
            <div className="text-[13px] text-muted"><span className="font-bold text-soft">Speaks</span> · {p.languages.join(", ")}</div>
          )}

          {(p.instagram || p.facebook) && (
            <div className="flex flex-wrap gap-2">
              {p.instagram && (
                <a href={`https://instagram.com/${p.instagram.replace(/^@/, "")}`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-[7px] rounded-xl border-[1.5px] border-line bg-card px-[13px] py-[9px] text-[12.5px] font-semibold text-body">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[linear-gradient(135deg,#7b5cd6,#e0566f,#f2a24b)] text-[8px] font-bold text-white">IG</span>
                  {p.instagram}
                </a>
              )}
              {p.facebook && (
                <span className="flex items-center gap-[7px] rounded-xl border-[1.5px] border-line bg-card px-[13px] py-[9px] text-[12.5px] font-semibold text-body">
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#3b6fd4] font-serif text-[10px] font-bold text-white">f</span>
                  {p.facebook}
                </span>
              )}
            </div>
          )}

          {p.is_me ? (
            <PrimaryButton href="/you/edit">edit profile</PrimaryButton>
          ) : (
            <div className="flex flex-col gap-2">
              <SayHello personId={p.id} className="!h-[50px] !text-[22.5px]" label={p.chat_id ? "Open chat" : "Say hello"} />
              <FriendButton personId={p.id} state={{ isFriend: !!p.is_friend, request: p.friend_request }} />
              <div className="mt-1 text-center"><ReportBlock personId={p.id} name={p.first_name} /></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RailItem({ glyph, label, sub }: { glyph: string; label: string; sub?: string | null }) {
  return (
    <div className="flex flex-col items-center gap-[3px] px-1">
      <span className="text-[15px]">{glyph}</span>
      <span className="text-center text-[10px] leading-[1.15] font-bold text-soft">{label}</span>
      {sub && <span className="text-center text-[9.5px] leading-[1.1] font-bold text-pink">{sub}</span>}
    </div>
  );
}
