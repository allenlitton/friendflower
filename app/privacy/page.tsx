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
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] pt-4 pb-8 text-[16.2px] leading-[1.55] text-body">
        <div>
          <SectionLabel>Who sees what</SectionLabel>
          <Card className="px-[15px] py-1">
            {ROWS.map(([who, what]) => (
              <div key={who} className="border-b border-rule py-3 last:border-0">
                <div className="text-[16.8px] font-semibold text-text">{who}</div>
                <div className="mt-0.5 text-[15px] text-muted">{what}</div>
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
          <p className="mt-2">
            When you ask <b>Fo Concierge</b> for something while live distance is on, your latest position (rounded to about 100 m)
            and the nearest neighbourhood go with your request, so Fo can find places near you. Fo runs on Friend Flower&apos;s own
            Fo account. Nothing about your location is sent when live distance is off.
          </p>
        </div>
        <div>
          <SectionLabel>Fo Concierge and your friends</SectionLabel>
          <p>
            When you ask Fo for something, it gets the names of your friends so it can draft a Friend Flower message for you. A drafted
            message only goes out, as you, when you tap Send.
          </p>
          <p className="mt-2">
            Fo only learns more about you if you turn on <b>Share with my friends&apos; Fo Concierge</b> in Settings (it&apos;s off by
            default). Then, when one of your friends asks Fo for help, Fo can see where you are (your city, your neighbourhood if you show
            distance, and trips that friend can already see) and the email or phone you chose, so it can contact you for them.
            Never your live position. Turn it off any time and Fo stops getting any of it.
          </p>
        </div>
        <div>
          <SectionLabel>Safety</SectionLabel>
          <p>
            You can report or block anyone from their profile or your chat. Blocking hides you from each other everywhere.
            Questions? <a className="text-pink" href="mailto:hello@friendflower.app">hello@friendflower.app</a>
          </p>
        </div>
      </div>
    </main>
  );
}
