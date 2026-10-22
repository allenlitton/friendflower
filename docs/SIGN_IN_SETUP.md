# Setting up Sign in with Apple and Google

The code is in place, but nothing shows until these steps are done. The buttons only appear
once `NEXT_PUBLIC_SIGNIN_PROVIDERS` is set (step 5), and the iPhone app only shows them from
version 1.1, which has the native sign-in plugin. Version 1.0 keeps email only.

Values you'll need again are marked **(save)**. The Supabase callback URL used below is
`https://foofpoaozqtqieocgucn.supabase.co/auth/v1/callback`.

## 1. Apple Developer (developer.apple.com → Certificates, IDs & Profiles)

1. **Identifiers → `app.friendflower.ios`** → tick **Sign in with Apple** → Save.
2. **Identifiers → +** → **Services IDs** → description "Friend Flower web", identifier
   `app.friendflower.web` **(save: Services ID)** → Register. Open it, tick **Sign in with
   Apple** → **Configure**:
   - Primary App ID: `app.friendflower.ios`
   - Domains: `friendflower.app` and `foofpoaozqtqieocgucn.supabase.co`
   - Return URL: the Supabase callback URL above
3. **Keys → +** → name "Friend Flower Sign in with Apple" → tick **Sign in with Apple** →
   Configure → primary App ID `app.friendflower.ios` → Register. Download the `.p8` file
   **(save: the file, and its Key ID)**. Apple only lets you download it once.

## 2. Google Cloud (console.cloud.google.com → Google Auth Platform)

1. **Branding**: app name "Friend Flower", support email, logo, authorised domain
   `friendflower.app`, privacy policy `https://friendflower.app/privacy`, terms
   `https://friendflower.app/terms`.
2. **Audience**: External, then **Publish app** (email and profile need no Google review).
3. **Clients → Create client → Web application**:
   - Authorised JavaScript origins: `https://friendflower.app`
   - Authorised redirect URIs: the Supabase callback URL above
   - **(save: Web client ID and client secret)**
4. **Clients → Create client → iOS**, bundle ID `app.friendflower.ios`
   **(save: iOS client ID)**.

## 3. Supabase (supabase.com/dashboard → the project → Authentication)

1. **Sign In / Providers → Google**: turn on.
   - Client IDs: the Web client ID, a comma, then the iOS client ID
   - Client Secret: the Web client secret
   - Leave "Skip nonce checks" off.
2. **Sign In / Providers → Apple**: turn on.
   - Client IDs: `app.friendflower.web,app.friendflower.ios`
   - Secret Key: use Supabase's generator on that page with the Team ID `UC3QB2G4WS`,
     the Key ID and the `.p8` file. **It expires after 6 months**, so put a reminder in your
     calendar to make a new one.
3. **URL Configuration → Redirect URLs**: make sure `https://friendflower.app/auth/confirm`
   is listed (email sign-in already uses it).
4. **SQL Editor**: run `supabase/migrations/20261022000027_apple_sign_in.sql`.

## 4. Vercel (the friendflower project → Settings → Environment Variables, Production)

| Name | Value |
|---|---|
| `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` | the iOS client ID |
| `APPLE_SERVICES_ID` | `app.friendflower.web` |
| `APPLE_SIGNIN_KEY_ID` | the key's Key ID |
| `APPLE_SIGNIN_PRIVATE_KEY` | the whole `.p8` file's text |

## 5. Turn the buttons on

Add `NEXT_PUBLIC_SIGNIN_PROVIDERS` = `apple,google` in Vercel, then **redeploy** production.
Try both buttons on friendflower.app.

## 6. iPhone app 1.1

Send Claude the iOS client ID. It goes into the app's Info.plist (Google needs it as a URL
scheme), then 1.1 is built and uploaded for TestFlight and review.
