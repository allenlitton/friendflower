import { BackBar, SectionLabel } from "@/components/ui";

// Plain-language terms. Apple requires apps with user-generated content to have
// terms that rule out objectionable content and abusive people. Have a lawyer
// review this before a wide public launch.
const SECTIONS: [string, string][] = [
  ["Who can use Friend Flower", "You must be at least 18. Use your real name and photo, and only one account per person."],
  ["Be kind, or you're out", "There is no place here for harassment, hate, threats, sexual content involving anyone without their consent, nudity, spam, scams, impersonation, or anything illegal. We remove content and accounts that break these rules, without warning, and we may report serious cases to the authorities."],
  ["Report and block", "Every profile and chat has a Report or block option. Blocking hides you from each other everywhere. Reports go to our team, and we act on them within 24 hours."],
  ["Your content", "You keep what you post (your profile, photos and messages). You let us show it to the people you chose to share it with so the app can work. You promise it's yours to share."],
  ["Meeting people", "Friend Flower helps you meet friends of friends. Meet in public places first, and tell someone where you're going. We can't vouch for anyone, and you're responsible for what you do offline."],
  ["Fo Concierge", "Fo is an assistant that acts on your requests. It checks with you before spending money, but you are responsible for what you ask it to do and for anything you approve."],
  ["Your account", "You can delete your account any time in You → Settings → Delete my account. That removes your profile, messages, photos, contact codes and location. We may suspend accounts that break these terms."],
  ["No guarantees", "The app is provided as is. To the extent the law allows, we aren't liable for lost data, or for what other people say or do."],
  ["Contact", "Questions or concerns: hello@friendflower.app."],
];

export default function TermsPage() {
  return (
    <main className="flex flex-1 flex-col">
      <BackBar href="/you" title="Terms of use" />
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-[22px] pt-4 pb-8 text-[16.2px] leading-[1.55] text-body">
        {SECTIONS.map(([title, body]) => (
          <div key={title}>
            <SectionLabel>{title}</SectionLabel>
            <p>{body}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
