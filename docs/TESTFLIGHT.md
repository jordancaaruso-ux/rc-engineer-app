# TestFlight checklist (RC Engineer)

This app is a **Next.js** site wrapped with **Capacitor** (`ios/`). The native shell loads your deployed origin (`CAPACITOR_SERVER_URL` / `server.url` in `capacitor.config.ts`).

## 1. Apple Developer Program

1. Enroll at [developer.apple.com](https://developer.apple.com) ($99/year). Identity verification can take 24–48h.
2. In **App Store Connect**, create a new app with bundle id `com.rcengineer.app` (or change `appId` in `capacitor.config.ts` and re-sync).
3. Note your **Team ID** for Associated Domains / entitlements later.

## 2. Hosting + environment (Vercel)

Production must expose:

- `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL` (same origin users open in the browser)
- `AUTH_ALLOWED_EMAILS` + `npx prisma db seed` (or rows in `AuthAllowedEmail`)
- `EMAIL_SERVER` / `EMAIL_FROM` for magic links in real use
- `BLOB_READ_WRITE_TOKEN` for PDF storage

Run `npx prisma db push` (or migrate deploy) after pulling schema changes.

## 3. Capacitor sync

On a Mac with Xcode:

```bash
export CAPACITOR_SERVER_URL="https://YOUR-VERCEL-URL.vercel.app"
npm run cap:sync
npm run cap:open
```

(`cap:sync` / `cap:open` are npm aliases for `cap sync ios` / `cap open ios`.)

Set **Signing & Capabilities** in Xcode (team, bundle id). Build to a device or archive for TestFlight.

## 4. Magic links in the iOS shell

Mail taps often open **Safari**, while the app uses a **WKWebView** with its own cookie jar — the session may not appear in the app until the callback runs **inside the WebView**.

Mitigations:

- **Associated Domains** (recommended): host `apple-app-site-association` on your `AUTH_URL` origin and add the domain capability in Xcode so `https://your-domain/...` opens the app.
- **Custom URL scheme**: add a URL type in Xcode (`rcengineer` or similar) and configure Auth.js / email templates to use that scheme for callbacks (advanced).

`CapacitorDeepLinkBridge` (`src/components/capacitor/CapacitorDeepLinkBridge.tsx`) forwards `appUrlOpen` events for paths containing `/api/auth/` or `/login` into the WebView.

## 5. TestFlight

1. Archive in Xcode → **Distribute App** → App Store Connect → **TestFlight**.
2. Answer **export compliance** (uses HTTPS; standard encryption).
3. **App Privacy** questionnaire: disclose Postgres host, Vercel Blob, OpenAI (if used), email provider.
4. **Privacy Policy URL** — required. This repo exposes a minimal page at **`/privacy`** on your deployment (e.g. `https://YOUR_VERCEL_URL/privacy`). Replace copy or host your own policy if you need legal review.
5. Add **Internal testers** (up to 100, no review).

## 6. Icons and splash

Replace default Xcode / Capacitor assets:

- App icon: Xcode **Assets.xcassets** → AppIcon.
- Splash: use Capacitor Splash Screen plugin config or Xcode storyboard (`LaunchScreen`).

## 7. WKWebView session smoke test

After sign-in:

1. Background the app for several minutes.
2. Relaunch and confirm you remain signed in (JWT session cookie behavior).

If sessions drop, verify `AUTH_URL` matches the loaded origin and cookie `Secure` / `SameSite` settings for your domain.
