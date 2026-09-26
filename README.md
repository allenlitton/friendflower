# Friend Flower

Meet friends of friends wherever you are. Web app (works on phones and can be
added to the home screen) built from the Claude Design prototype in `design/`.

**Stack:** Next.js (the website) · Supabase (sign-in, database, live chat,
photo storage) · Vercel (hosting). No servers to look after.

---

## 1. One-time setup

### Create the Supabase project (database + sign-in)
1. Go to <https://supabase.com> → **Start your project** → sign up (signing in with GitHub is easiest).
2. **New project** → name it `friendflower`, choose a strong database password (save it in your password manager), pick the region closest to your users (e.g. *West US*), and create it. It takes a minute or two.
3. **Set up the database:** left sidebar → **SQL Editor** → **New query**. Open each file in `supabase/migrations/` **in order** (`…01_schema`, `…02_functions`, `…03_reference_data`), paste its contents, and press **Run**. Each should say *Success*.
4. **Sign-in emails:** **Authentication → Emails → Magic Link** template. Replace the message body with:
   ```html
   <h2>Your Friend Flower sign-in code</h2>
   <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
   <p>Or <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">tap here to sign in</a>.</p>
   ```
5. **Authentication → URL Configuration:** set **Site URL** to `http://localhost:3000` for now (you'll change it to `https://friendflower.app` when you go live). Under **Redirect URLs** add `http://localhost:3000/**` and `https://friendflower.app/**`.
6. **Project Settings → API Keys:** keep this page open — you need the Project URL, the `anon` key and the `service_role` key next.

### Run it on your computer
```bash
cd ~/friendflower
cp .env.example .env.local
```
Open `.env.local` and paste in the three Supabase values. For `CONTACT_HASH_PEPPER`, run `openssl rand -hex 32` in Terminal and paste the result. **Save the pepper in your password manager and never change it** — if it changes, existing contact matches stop working.

```bash
npm install
npm run dev
```
Open <http://localhost:3000> and sign in with your email.

### Put it online (Vercel)
1. Put the code on GitHub (a private repository).
2. Go to <https://vercel.com> → sign up with GitHub → **Add New → Project** → import the repository.
3. Before deploying, open **Environment Variables** and add the same four values from `.env.local`.
4. **Deploy.** Then **Settings → Domains** → add `friendflower.app` and follow the DNS instructions.
5. Back in Supabase, change the **Site URL** to `https://friendflower.app`.

Every time new code is pushed to GitHub, Vercel updates the site automatically.

### Before real launch
- **Email sending:** Supabase's built-in email is only for testing (it sends a handful per hour). Set up a free [Resend](https://resend.com) account and add it under **Authentication → Emails → SMTP Settings**.
- **Review the venue list** in `supabase/migrations/…03_reference_data.sql` (check they're still open, and the notes sound like you).

---

## 2. How it works

| Thing | Where it lives |
|---|---|
| Screens | `app/` — one folder per screen (`nearby`, `world`, `trips`, `places`, `chats`, `you`, `people/[id]`, `chat/[id]`) |
| Shared look (buttons, avatars, flower logo) | `components/ui.tsx` |
| Colours and fonts | `app/globals.css` (top of file) |
| Database tables | `supabase/migrations/…01_schema.sql` |
| Who-can-see-what rules, friend graph, verification | `supabase/migrations/…02_functions.sql` |
| Cities, neighbourhoods, venues | `supabase/migrations/…03_reference_data.sql` — see `docs/ADDING_A_CITY.md` |

### The friend graph
- **1st degree** = two people who each have the other in their contacts, *or* who became friends with **Add friend** (or an invite link).
- **2nd degree** = a friend of a 1st-degree friend, or someone from the same school within a year.
- If only one side has the other's number, they're shown an **Add friend** suggestion instead. That way, knowing someone's number never reveals their neighbourhood to you.
- **Saved friends** (added or accepted) are the people on the **World** page.

### Mutual-friend verification (friends of friends)
Three ways, all chosen on the "how you know each other" screen:
1. **In the app:** the other person agrees → a 3-person chat opens → the mutual friend taps **Yes, I know them both** (and can add an intro). They can leave the chat afterwards.
2. **By link:** a one-tap link you text to the mutual friend, for when they're offline or not on the app yet.
3. **Already checked:** you confirmed it yourself off the app. This shows as *self-reported*.

Requests expire after 7 days, and verification is permanent once confirmed.

### Privacy, built in
- Every read of another person goes through a database function that checks your connection first. Tables only ever return your own rows.
- Contacts are hashed on the server with the secret pepper. Raw numbers and emails are never stored, and users can delete their uploads.
- No live location anywhere. People only have a declared city, an optional neighbourhood, and trips.
- Report and block work from any profile or chat.

---

## 3. Checks

```bash
npm run test:db     # privacy & verification tests (runs the real database code, no account needed)
npm run typecheck
npm run lint
```

## 4. Not in this version
AI concierge (shown as "coming soon"), payments / Bloom plan, Instagram / Facebook / LinkedIn login and matching,
push notifications, reservations and partner venues, venue/business accounts, app languages, live location (never).
