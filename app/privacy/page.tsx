import { BackBar, Card, SectionLabel } from "@/components/ui";

const ROWS: [string, string][] = [
  ["Friends (1st degree)", "Your photo, name, bio, how far away you are (only if you both turn on live distance), online status, the city you live in, trips you share with them, cities you've lived in, schools, and mutual friends."],
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
            We know the places you tell us: the city you live in, an optional neighbourhood, and trips you add. We don&apos;t show
            anyone a distance from these.
          </p>
          <p className="mt-2">
            <b>Live distance</b> is off unless you turn it on. When it&apos;s on, the app sends your position about once a minute, only while
            it&apos;s open. We round it to about 100 m and keep only the latest one; it stops being used after 30 minutes and is deleted soon
            after, or straight away when you turn live distance off. People in your circle who also share theirs see how far away you
            are (to 0.1 mi) — never your location itself.
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
