import { BackBar, Card, SectionLabel } from "@/components/ui";

const ROWS: [string, string][] = [
  ["Friends (1st degree)", "Your photo, name, bio, rough distance, online status, the city you live in, trips you share with them, cities you've lived in, schools, and mutual friends."],
  ["Friends of friends (2nd degree)", "The same — marked “not verified” until a mutual friend confirms you really are connected. You can switch this off in You → Who can see me."],
  ["Everyone else", "Nothing. People outside your circle can't find you."],
];

export default function PrivacyPage() {
  return (
    <main className="flex flex-1 flex-col">
      <BackBar href="/you" title="Your data" />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] pt-4 pb-8 text-[13.5px] leading-[1.55] text-body">
        <div>
          <SectionLabel>Who sees what</SectionLabel>
          <Card className="px-[15px] py-1">
            {ROWS.map(([who, what]) => (
              <div key={who} className="border-b border-rule py-3 last:border-0">
                <div className="text-[14px] font-semibold text-text">{who}</div>
                <div className="mt-0.5 text-[12.5px] text-muted">{what}</div>
              </div>
            ))}
          </Card>
        </div>
        <div>
          <SectionLabel>Your contacts</SectionLabel>
          <p>
            We only look at phone numbers and email addresses. On our server they&apos;re turned into scrambled codes (a one-way
            “hash” with a secret key) and the originals are thrown away. We use the codes only to spot people who have each other in their
            contacts. Your contact list is never shown to anyone, and you can delete it any time from Find your friends.
          </p>
        </div>
        <div>
          <SectionLabel>Your location</SectionLabel>
          <p>
            Friend Flower never tracks where you are. The only places we know are the ones you tell us: the city you live in, an optional
            neighbourhood, and trips you add. Distances are worked out between neighbourhood or city centres, so they&apos;re always approximate.
          </p>
        </div>
        <div>
          <SectionLabel>Safety</SectionLabel>
          <p>
            You can report or block anyone from their profile or your chat. Blocking hides you from each other everywhere.
            Questions? <a className="text-pink" href="mailto:help@friendflower.app">help@friendflower.app</a>
          </p>
        </div>
      </div>
    </main>
  );
}
