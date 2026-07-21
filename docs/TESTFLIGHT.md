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

## 6. Icons and splash — done

Both native asset sets are generated from the brand sources and committed:

- **App icon** — `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`, from `public/icons/icon-1024.png`.
- **Splash** — `Splash.imageset`, JRC mark on `#121110` (matches `ios.backgroundColor` so overscroll doesn't flash).

> **Alpha channel:** App Store Connect rejects an app icon that carries an alpha channel, *even a fully opaque one* — the PWA source PNG has one, so the generated icon is flattened and `removeAlpha()`'d. If you ever regenerate the icon, keep that step or the first upload fails after the archive.

## 7. Push notifications (APNs)

The web-push path (`VAPID_*`, service worker) **cannot reach the shell** — WKWebView has no Push API. The native app uses APNs. The web/PWA path is unchanged and still used in browsers.

Already wired in this repo:

- `@capacitor/push-notifications` + the two `AppDelegate` callbacks that deliver the token.
- `CapacitorPushBridge` — routes a notification tap to `data.url` (same payload contract as the service worker) and re-registers the token on launch, since APNs tokens rotate.
- Settings → Notifications detects the shell and uses the native enable/disable flow.
- `NativePushDevice` model + `/api/push/native/register|unregister`.
- `sendPushToUser` fans out to **both** transports, so the existing triggers (Speedhive result watch, log reminder, test push) reach the app with no caller changes.

### Steps that need the Mac / Apple portal

1. **Xcode → Signing & Capabilities → + Capability → Push Notifications.** This writes the `aps-environment` entitlement; without it registration fails at runtime. (Not committed here — it edits the Xcode project.)
2. **Apple Developer → Keys → new key with APNs enabled.** Download the `.p8` **once** — it can't be re-downloaded.
3. Set on Vercel:

   ```
   APNS_KEY_ID=<10-char key id>
   APNS_TEAM_ID=<10-char team id>
   APNS_PRIVATE_KEY=<contents of the .p8>   # literal \n escapes are handled
   APNS_BUNDLE_ID=com.rcengineer.app
   APNS_PRODUCTION=1                        # see below
   ```

4. Apply the migration: `prisma/migrations/20260720120000_add_native_push_device/` (via `migrate deploy` — never `db push` against prod).
5. Verify: Settings → **Enable notifications** (accept the iOS prompt) → **Send test**.

> **Environment gotcha:** `APNS_PRODUCTION=1` targets `api.push.apple.com`, used by **TestFlight and App Store builds**. Only a build run directly from Xcode onto a device uses the sandbox host. A token minted in one environment is rejected by the other with `BadDeviceToken` — if test pushes silently do nothing, check this first.

## 8. WKWebView session smoke test

After sign-in:

1. Background the app for several minutes.
2. Relaunch and confirm you remain signed in (JWT session cookie behavior).

If sessions drop, verify `AUTH_URL` matches the loaded origin and cookie `Secure` / `SameSite` settings for your domain.
