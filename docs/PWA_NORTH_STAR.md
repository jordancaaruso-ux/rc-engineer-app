# PWA & Notifications North Star

**Status:** Living. **Owner:** Jordan. Started 2026-07-11.

How JRC Race Engineer becomes an app-like, installable, notifying product **without leaving
the web codebase** — the free/instant complement to the eventual Capacitor App Store build
(`docs/TESTFLIGHT.md`). PWA is the **testing + daily-dogfood channel now**; Capacitor is the
store path later. Both reuse the same Next.js app.

> **Why two tracks?** A PWA (Add to Home Screen) costs $0 and no Apple account, but is capped
> by what iOS Safari allows: **no haptics ever**, no App Store, storage evicted after ~7 idle
> days. Capacitor lifts all of those. Anything a PWA *can* do, we do here first.

---

## 1. What shipped 2026-07-11 (PWA polish + install prompt)

| Piece | File | Effect |
|---|---|---|
| Web app manifest | `src/app/manifest.ts` | Name, `display: standalone`, charcoal splash/theme, install icons (Android/desktop). Served at `/manifest.webmanifest`. |
| Apple home-screen meta | `src/app/layout.tsx` (`metadata.appleWebApp`) | Full-screen launch, `black-translucent` status bar (charcoal flows under the clock), home-screen title "JRC Engineer". |
| apple-touch-icon | `layout.tsx` (`metadata.icons.apple`) | The iOS home-screen tile (iOS ignores the manifest icons for this). |
| Standalone detection | `layout.tsx` bootstrap script → `html[data-standalone="true"]` | Gates native-feel CSS to installed launches only. |
| Native-feel CSS | `globals.css` (`html[data-standalone]` block) | Kills rubber-band overscroll, tap-flash, long-press callout on chrome — **only when installed**; browser UX untouched. Content stays selectable/copyable. |
| Install prompt | `src/components/pwa/PwaInstallPrompt.tsx` | Smart, gentle iOS-Safari-only Share→Add card; 2nd visit onward; dismiss persists ~60 days; portaled to `<body>`. |

Already present before this pass: `viewportFit: "cover"`, `themeColor: "#121110"`, `env(safe-area-inset-*)` handling.

### Still to do on the PWA track
- [ ] **Icon + splash art** (§2) — the manifest/apple-touch links point at `public/icons/*`; drop the PNGs in.
- [ ] **Service worker** — offline app shell + the transport for web push (§3). Deferred: it can subtly break caching, so it gets its own pass + `/verify`.
- [ ] Optional: passive "Get the app" entry in `AccountMenu` for users who dismissed the popup.

---

## 2. Asset checklist (drop-in — no code change needed)

Create `public/icons/` and add:

| File | Size | Purpose |
|---|---|---|
| `apple-touch-icon.png` | 180×180 | **iOS home-screen tile.** No transparency, no rounded corners (iOS masks it). Full-bleed art on the charcoal/yellow brand. |
| `icon-192.png` | 192×192 | Android / desktop install + favicon fallback. |
| `icon-512.png` | 512×512 | Android install / splash source. |
| `icon-maskable-512.png` | 512×512 | Android adaptive icon — keep the mark inside the center 80% "safe zone" (outer 10% each edge may be cropped). |

**iOS launch splash (optional, removes the white cold-launch flash):** iOS needs one PNG per
device resolution, wired via `metadata.appleWebApp.startupImage` (media-query'd). Generate with
a tool (e.g. `pwa-asset-generator`) from a single 2048×2732 source, output to `public/icons/splash/`,
then add the `startupImage` array to `layout.tsx`. Do this once the icon art is final.

> Brand note: the existing `public/brand/jrc-race-engineer-logo.svg` is the **off-brand
> red→blue** gradient (see VISUAL_NORTH_STAR Known Gaps #2). Do **not** derive the app icon from
> it — use the yellow-on-charcoal lockup Jordan is designing.

---

## 3. Notifications — design (spec, not yet built)

### The iOS reality that shapes everything
Web push on iOS (16.4+, March 2023) works **only after the PWA is installed to the home
screen**, and only with user permission. So: **install prompt (done) → permission ask →
service worker → push**. This is why the install flow is the foundation, not a nicety.

### Architecture (web push, standard stack)
```
Service worker (public/sw.js)         ← receives 'push' + 'notificationclick'
  + PushManager.subscribe(VAPID)      ← per-device subscription, stored server-side
  + Web Push protocol from the server ← we send via a VAPID keypair
```
- **Model:** `PushSubscription` (userId, endpoint, keys, platform, createdAt). One row per device.
- **Keys:** `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` env (generate once). Public key ships to client.
- **Send lib:** `web-push` (Node) from a server action / route / cron.
- **Permission UX:** never on load. Ask contextually — e.g. after a first successful run log:
  "Want a nudge when a new result posts for your transponder?" (tap-to-answer, consistent with
  the Engineer's asking UX). Respect denial; offer a re-ask entry in Settings.
- **Capacitor parity:** when the native shell ships, swap the delivery layer to `@capacitor/push-notifications` (APNs) behind the same `PushSubscription` model + trigger code — triggers below don't change.

### The four triggers (founder-selected 2026-07-11)

| # | Trigger | Value | Build cost | Notes |
|---|---|---|---|---|
| **1** | **New result → add run** | ★★★ Feeds Pillar 1 (effortless logging), the always-#1 pillar | High (backend detection) | Own section below — the flagship. |
| **2** | **Engineer read ready** | ★★ | Low — fires from our own app after a log | When the post-run read/suggestion card is computed, push "Your read on Run N is ready." Deep-link to the card. Cheapest first win — good pilot for the whole push stack. |
| **3** | **Teammate activity** | ★★ Team multiplier at events | Medium | Teammate logs a run / shares a setup at a shared event → notify the team. Gate on existing team-visibility (`teamAccess.ts` / `teammateRunAccess.ts`); respect share flags; debounce/batch so a busy heat doesn't spam. |
| **4** | **Suggestion follow-up** | ★★ Powers the suggestion-lifecycle loop | Medium | "You tried stiffer front springs last run — was it better?" Fires when a suggestion-linked run is logged without an outcome. **Depends on Engineer Phase 3 (suggestion lifecycle), not yet built.** |

**Recommended build order:** #2 (proves the push stack end-to-end, cheap) → #1 (the flagship) →
#3 → #4 (blocked on suggestion lifecycle).

### Flagship: "New result → add run" (design only — real backend feature)

**Goal:** the driver's transponder posts a result on a timing site → they get a push → one tap
starts an Add-Run pre-filled with that result. Removes the "remember to log it" step entirely.

**Open design questions (resolve before building):**
1. **Detection source.** LiveRC and Speedhive (MyLaps) are the two big ones. Is there a public
   API / per-driver feed / stable HTML to poll, or only event-page scraping? **This is the
   feasibility crux — spike it before committing** (the "prototype detection" option we deferred).
2. **Identity link.** Driver stores their **transponder number** and/or a **LiveRC/Speedhive
   profile URL** in their JRC profile. New model field(s): `Driver.transponderId`,
   `Driver.liveRcResultsUrl`.
3. **Detection loop.** A cron/queue (Vercel Cron) polls known sources for linked drivers on an
   interval during likely race windows. Dedupe on `(source, resultId)`; store `SeenResult` so we
   never double-notify. Webhook instead of poll if any source offers one (unlikely).
4. **Payload → deep link.** Notification opens `/runs/new?fromResult=<id>` — Add Run reads the
   result (event, class, round, laps/time) and pre-fills. Ties into existing lap-import.
5. **Trust / noise.** Only notify for *the driver's own* transponder; let them mute per event;
   never fabricate a result if parsing is uncertain — link out instead.

**Why design-only now:** this is a genuine backend feature (external integration + polling +
dedupe + a new data model), not a PWA chrome item. It deserves its own build + `/verify` pass,
and its #1 unknown (can we reliably detect a result?) should be spiked first. It is, however,
the single most on-strategy notification — it directly strengthens the core loop's logging step.

---

## 4. The honest PWA ceiling (why Capacitor still comes later)

| Want | PWA | Capacitor |
|---|---|---|
| Home-screen install, full-screen, splash | ✅ (this doc) | ✅ |
| Push notifications | ✅ iOS 16.4+, installed-only | ✅ APNs, richer |
| Offline app shell | ⚠️ SW cache; iOS evicts after ~7 idle days | ✅ durable |
| Camera / video | ⚠️ basic web APIs | ✅ native |
| **Haptics** (`haptic()` primitive) | ❌ **never on iOS web** | ✅ `@capacitor/haptics` (already installed) |
| App Store listing | ❌ | ✅ |

**Cross-references:** `docs/TESTFLIGHT.md` (Capacitor/App Store path), `capacitor.config.ts`
(native shell, currently `server.url` remote-load — note: true offline logging needs a bundled
build + local sync, a separate project), `PRODUCT_NORTH_STAR.md` (iOS decision within 6 months;
Pillar 1 = effortless logging).
