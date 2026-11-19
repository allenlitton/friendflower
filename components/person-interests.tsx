import type { PersonInterest } from "@/lib/types";
import { conversationStarters } from "@/lib/interests";
import { SectionLabel } from "@/components/ui";

/** Someone's interest tags, with the ones you share highlighted, and conversation starters for those. */
export function PersonInterests({ interests }: { interests: PersonInterest[] }) {
  if (interests.length === 0) return null;
  const shared = interests.filter((t) => t.shared).map((t) => t.name);
  const starters = conversationStarters(shared);
  return (
    <>
      <div>
        <SectionLabel>{shared.length > 0 ? `Into · ${shared.length} in common` : "Into"}</SectionLabel>
        <div className="flex flex-wrap gap-[7px]">
          {interests.map((t) => (
            <span key={t.id}
              className={`rounded-full border-[1.5px] px-3 py-[7px] text-[15px] font-semibold ${
                t.shared ? "border-pink bg-pink text-ink" : "border-line bg-card text-body"}`}>
              {t.shared && "✿ "}{t.name}
            </span>
          ))}
        </div>
      </div>

      {starters.length > 0 && (
        <div className="rounded-[14px] border-[1.5px] border-plum-line bg-plum px-[13px] py-[11px]">
          <div className="text-[13.8px] font-bold tracking-[.06em] text-pink uppercase">Conversation starters</div>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {starters.map((s) => (
              <li key={s} className="text-[15.6px] leading-snug text-[#f3d6df]">“{s}”</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
