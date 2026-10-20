# Friend Flower on the App Store and Google Play: plan and costing

Draft, 2026-10-20. Fee figures are from memory of Apple's and Google's published pricing, so confirm them on the sign-up pages before paying. Labour figures are estimates.

## 1. Where we are

Friend Flower is a Next.js 16 app (server-rendered) with Supabase (email-code sign-in, Postgres, realtime chat, storage) on Vercel. Today it is a PWA ("Add to Home Screen").

What the app needs from a phone:

- **Contacts.** `app/connect/connect-client.tsx` uses the browser Contact Picker, which Android Chrome has and **iOS Safari does not**. iOS users currently fall back to uploading a vCard.
- **Location.** `components/live-location.tsx` uses browser geolocation while the app is open.
- **Notifications.** None yet. Chat and friend requests only appear when the app is open.
- **Fo Concierge.** Runs server-side through one shared Wajo account.

## 2. Recommended approach: Capacitor shell around the existing web app

Use **Capacitor** (Ionic) to produce an iOS and an Android app from this one codebase. The native shell loads the live site (`server.url` pointing at friendflower.app), so web releases keep shipping through Vercel without store review. Native code is limited to plugins.

Why this over the alternatives:

| Option | Verdict |
|---|---|
| **Capacitor shell (recommended)** | Reuses 100% of the UI. About 4-6 weeks. Main risk is Apple review (see section 4). |
| Rewrite in React Native / Expo | Cleaner native feel, but it rebuilds every screen and the chat, map and Fo flows. Roughly 3-4x the cost. Revisit only if the shell feels wrong after launch. |
| Trusted Web Activity (Android only) | Cheapest for Google Play, but gives no iOS app. Could be a stopgap, not the plan. |
| Stay a PWA | Free, but it isn't on the stores, and iOS has no push or contact picker. |

## 3. Why a plain wrapper isn't enough (and what we add)

Apple Guideline 4.2 rejects apps that are just a website in a frame. These native features justify the app and fix real gaps:

1. **Native contacts** (`@capacitor-community/contacts` or similar). This gives iOS users the one-tap import they lack today. We keep the existing hash-on-server design and add the contacts permission string and the explanation in the privacy page.
2. **Push notifications** (APNs and FCM through `@capacitor/push-notifications`). New messages, friend requests, accepted invites and "friend arrived in your city". This needs a `device_tokens` table, a Supabase edge function or database trigger to send, and a settings toggle.
3. **Native geolocation** (`@capacitor/geolocation`) for a proper OS permission prompt. Foreground only, so we avoid the "always" location review.
4. **Universal Links and App Links** so invite links (`/invite/[code]`) and sign-in links (`/auth/confirm`) open in the app. Needs `apple-app-site-association` and `assetlinks.json` served from the site.
5. Native splash, icon, status bar and safe-area handling, and haptics on key actions.

## 4. Store-review requirements we don't meet yet

These are the usual rejection causes, and several are gaps in the code today.

| Requirement | Store | Status in repo | Work |
|---|---|---|---|
| **In-app account deletion** (5.1.1(v); Play requires it too, plus a web URL) | Both | **Missing**. Only sign-out exists. | "Delete my account" in Settings. A Supabase function removes the profile, contact hashes, location, messages and photos. Add a public web page for deletion requests. |
| **User-generated content moderation** (1.2): report, block, terms, contact info | Apple mainly | Blocking exists. A **report** flow and Terms of Service acceptance **look missing**. | Report user/message action, an admin queue (a table and email alert is enough at first), ToS page, EULA acceptance at onboarding. |
| **Privacy policy URL**, App Privacy "nutrition label", Play Data Safety form | Both | `/privacy` is an in-app explainer, not a full legal policy. | Full privacy policy and ToS at stable public URLs. Declare contacts (hashed), location (approximate), email, photos, user content and identifiers. |
| **Sign in with Apple** (4.8) | Apple | Not required while the only login is our own email code. It becomes required if we add Google or Facebook login. | None now. Don't add social login without adding this. |
| **Reviewer demo account** | Both | Sign-in is by emailed code, so a reviewer can't log in. | Add a fixed-code review account (an allow-listed email with a static OTP, Supabase test OTP setting) and put the details in review notes. |
| **Fo Concierge can spend money** | Apple | Fo is told to ask first, which is good. | Describe it in review notes. If we later charge for Fo or a premium tier, digital features must use Apple In-App Purchase and Google Play Billing (15-30% fee). Real-world purchases via Fo are fine. |
| **Age rating, export compliance, content questionnaire** | Both | n/a | Forms. Expect 12+ or 17+ given user chat and meeting strangers-of-friends. |
| **Google new-account testing rule** | Play | n/a | A new *personal* developer account needs a closed test with 12+ testers for 14 days before production. An *organization* account avoids this but needs a D-U-N-S number (free, about 1-2 weeks) and verification. |

## 5. Work breakdown and effort

Hours are for one experienced developer working with Claude Code. Calendar time is longer because of review queues.

| # | Workstream | Hours |
|---|---|---|
| 1 | Capacitor project setup, iOS and Android builds, signing, icons and splash, safe areas, env/config, CI build script | 20-30 |
| 2 | Native contacts import (both platforms) and permission copy | 12-20 |
| 3 | Native geolocation and permission flow | 6-10 |
| 4 | Push notifications: device-token table, send pipeline, APNs key and FCM setup, in-app toggles, deep-link on tap | 30-45 |
| 5 | Universal/App Links: invite and sign-in deep links, association files, sign-in code flow inside the shell | 12-18 |
| 6 | Account deletion (app and web), report/block polish, ToS acceptance, moderation queue | 20-30 |
| 7 | Review demo account, privacy policy and ToS pages, data-safety and nutrition-label answers | 8-14 |
| 8 | Store listings: screenshots (6.9", 6.5", iPad if offered, Android phone), description, keywords, preview video optional, feature graphic | 14-24 |
| 9 | Device QA on real iPhones and Androids, offline/poor network, chat realtime, permissions denied paths | 24-40 |
| 10 | Review rounds and fixes (budget 1-2 rejections) | 10-20 |
| | **Total** | **~156-251 h** |

Not included: any Fo/Wajo usage charges, and a redesign.

## 6. Costing

### One-time and annual fees

| Item | Cost |
|---|---|
| Apple Developer Program | $99/year |
| Google Play Console | $25 one-time |
| Physical test devices (one mid-range Android, since the Mac and an existing iPhone cover iOS) | $150-300 |
| Legal review of privacy policy and ToS (recommended, since we handle contacts and location) | $500-2,000 |
| Screenshot and store-art design (or do it in-house) | $0-1,500 |
| D-U-N-S number for an organization account | $0 |
| **Subtotal** | **about $800-4,000** |

### Monthly running costs after launch

| Item | Cost |
|---|---|
| Supabase Pro (free tier pauses idle projects and caps usage, not workable for a store app) | $25/mo plus usage |
| Vercel Pro | $20/mo per seat |
| Transactional email (Resend or similar; the README already says Supabase's built-in email is test-only) | $0-20/mo |
| Push (APNs, FCM) | $0 |
| Error tracking (Sentry free tier) | $0 |
| **Subtotal** | **about $45-65/mo, roughly $550-800/year** |

### Labour, three ways

| Approach | Estimate |
|---|---|
| **Allen builds it with Claude Code** | $0 cash for labour. Plan on about 3-4 calendar weeks of part-time effort plus review waits. |
| **Freelance mobile developer** at $90-130/h | **$14,000-$33,000** (156-251 h) |
| **Small agency** at $150-200/h, with PM and QA | $25,000-$50,000 |

### Total first-year cash outlay

| Scenario | Total |
|---|---|
| DIY with Claude Code | **about $1,400-$4,800** (fees, devices, legal, hosting) |
| Freelancer | about $15,000-$38,000 |
| Agency | about $26,000-$55,000 |

## 7. Timeline (DIY or one contractor)

| Week | Milestones |
|---|---|
| 0 | Decide person vs organization developer account. Start the Apple enrollment (ID check, up to a few days; an organization takes longer) and the D-U-N-S request. Buy the Android device. |
| 1-2 | Capacitor shell running on both platforms. Account deletion, report and ToS. Reviewer account. Privacy policy and ToS published. |
| 2-4 | Native contacts, geolocation, push, deep links. |
| 4-5 | TestFlight beta to friends (Apple's beta review takes about a day). Google closed test starts (14-day clock if a personal account). |
| 5-6 | Store listings and screenshots. Submit to Apple (review is typically 1-3 days; plan on one rejection). |
| 6-8 | Production release on Google after the closed test window. Staged rollout at 20%, then 100%. |

Critical path: Google's 14-day test (personal account) or organization verification, and Apple's review. Start those early.

## 8. Risks

1. **Apple 4.2 "minimum functionality" rejection.** Mitigation: ship push and native contacts in the first submission, and explain the social features in the review notes.
2. **Sign-in inside the shell.** The emailed link opens the system browser, not the app. Use code entry as the primary path (it already exists) and universal links as the shortcut.
3. **Contacts and location privacy scrutiny.** We hash contacts and round location, which is a good story. State it plainly in the permission prompts and the privacy labels.
4. **Realtime chat and webviews.** iOS suspends background webviews, so push is what makes chat usable. Test reconnect on resume.
5. **Remote-loaded shell and "no code changes without review".** Apple allows web content updates, but not changing the app's primary purpose through them. Keep native-feature changes in app updates.
6. **Dependence on Fo/Wajo** being reachable. If it is down the rest of the app must still work. Verify the Fo-unavailable state is graceful before submitting.

## 9. Decisions needed from Allen

1. Developer account type: **individual** (faster to start, but Google's 12-tester rule applies, and your legal name is shown as the seller) or **organization** (needs a legal entity and D-U-N-S, with a company name as seller).
2. Build it yourself with Claude Code, or hire help for push and QA only (a hybrid at roughly 40-60 h, $4,000-$8,000).
3. Phones only, or iPad layout too (adds roughly 8-12 h of screenshots and layout checks).
4. Is any paid tier planned? If so, we design for In-App Purchase now rather than retrofit it.
5. Launch cities and timing, since the venue and city data limit how good the first-run experience is for reviewers.

## 10. Suggested first step

Start the Apple and Google enrollments this week, since they run on other people's clocks. In parallel, a first pull request that adds account deletion, a report flow and a ToS page. Those are required for approval and also useful on the web.
