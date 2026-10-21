import { getPlan } from "@/lib/plan";
import { requireProfile } from "@/lib/session";
import { BLOSSOM } from "@/lib/blossom";
import { shortDate } from "@/lib/format";
import { BackBar, Flower, SectionLabel } from "@/components/ui";
import { RedeemCode } from "./redeem-code";

const FEATURES = [
  { title: "Fo Concierge", free: "Not included", blossom: "Your own concierge for tables, flights and errands" },
  { title: "Deliveries", free: "Carry for others", blossom: "Find someone to carry a package for you" },
  { title: "World", free: `Up to ${BLOSSOM.freeFriends} saved friends`, blossom: "Every saved friend, wherever they are" },
  { title: "Nearby", free: `Up to ${BLOSSOM.freeNearby} people`, blossom: "Everyone nearby you have mutuals with" },
  { title: "Travel", free: "Where you are now", blossom: "See who's in a city before your trip starts" },
];

export default async function BlossomPage() {
  await requireProfile();
  const plan = await getPlan();

  return (
    <>
      <BackBar href="/you" title="Blossom" />
      <div className="flex flex-1 flex-col gap-[15px] overflow-y-auto px-5 pt-[18px] pb-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <Flower size={64} strokeWidth={3} />
          <div className="font-display text-[38px] leading-none">Blossom</div>
          <div className="text-[16.2px] text-muted">
            <span className="font-semibold text-text">{BLOSSOM.price}</span> a month
          </div>
        </div>

        {plan.isBlossom && (
          <div className="rounded-[18px] border-[1.5px] border-leaf-line bg-leaf-bg px-[15px] py-3.5 text-center">
            <div className="text-[17.4px] font-semibold text-leaf">You&apos;re on Blossom</div>
            {plan.until && (
              <div className="mt-0.5 text-[15px] text-body">
                {plan.source === "code" ? "Free with your code until" : plan.source === "gift" ? "Free for early members until" : "Renews"} {shortDate(plan.until.slice(0, 10))}
              </div>
            )}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border-[1.5px] border-line bg-card">
          {FEATURES.map((f) => (
            <div key={f.title} className="border-b border-rule px-[15px] py-3 last:border-0">
              <div className="text-[16.8px] font-semibold">{f.title}</div>
              <div className="mt-0.5 text-[14.4px] leading-snug text-pink">✿ {f.blossom}</div>
              <div className="text-[13.8px] leading-snug text-faint">Free: {f.free}</div>
            </div>
          ))}
        </div>

        {!plan.isBlossom && (
          <div className="rounded-2xl border-[1.5px] border-gold-line bg-gold-bg px-[15px] py-3 text-[15px] leading-snug text-body">
            Paying by card is coming soon. Until then, a friend&apos;s code turns Blossom on.
          </div>
        )}

        <div>
          <SectionLabel>{plan.isBlossom ? "Have another code?" : "Have a code?"}</SectionLabel>
          <RedeemCode />
        </div>
      </div>
    </>
  );
}
