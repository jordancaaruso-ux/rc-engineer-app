# Onboarding North Star — first run, first day

**Status:** ⚠️ **Partly superseded — see "Reversal 2026-07-23" below.** The guide chip, the derived
4-step progress, the resume/payoff/intro cards and the required-up-front timing step were retired after
the founder drove the empty account and found the chip dead-clicked, forced steps, and didn't teach.
Original spec (2026-07-22, 2 rounds over an artifact board) kept below for history. **Owner:** Jordan.
Prototype: https://claude.ai/code/artifact/7e5cd6ad-73fa-4a41-98d9-eb2e92315e7d

Governs what a brand-new account sees, from first sign-in to their first complete run. Sits under
`PRODUCT_NORTH_STAR.md` (pillar 1 — lap-time ingestion / session capture; nothing matters if the
first run never gets logged). Visual work on these screens follows `VISUAL_NORTH_STAR.md`.

---

## Reversal — 2026-07-23 (current model)

The founder drove the empty account and reopened the locked spec. The guide chip did nothing on a
dead-tap (you were already on the page, and the "pulse the yellow anchor" it leaned on was never wired
on the Garage hub — the `assets-cars/tracks/tires` anchors did not exist), it *forced* steps, and it
neither taught the app nor sold it. Re-derived from the founder's own priorities: **getting set up to log
the first run is #1**, most testers set up *ahead* of an event, and only a **car** is truly required —
timing and a setup are strongly advised but never gate.

**The whole apparatus collapses to two surfaces:**

1. **Welcome screen** — a full-screen overlay shown once on a truly-empty first sign-in (gated by
   `onboardingSeenAt`, both buttons write it, never returns). Framing line + 3 value bullets
   ("Log every run in seconds · Analyze your performance · Ask the Engineer") + "Get set up" +
   "Look around". An overlay, **not** a `/welcome` route (no redirect flash, no PWA back-strand).
   `src/components/onboarding/WelcomeScreen.tsx`, mounted by `DashboardHome` on `showIntro`.
2. **"Get set up" card** — one dashboard card, rows are **real links** (every tap navigates — no dead
   clicks). **Car** (required) gates the payoff: the moment a car exists the card flips to "You're ready
   — log your first run", with **Timing** and **Setup** persisting beneath as advised extras. The Setup
   row delegates to `UploadSetupSheetBar` (quick upload for a green-lit chassis, hand-build otherwise —
   never blocks). Dismissible (Ignore, reuses `onboardingResumeDismissedAt`); self-retires once
   car + timing + setup are in, a run exists, or dismissed.
   `src/components/dashboard/DashboardGetSetUpCard.tsx`.

**Timing moved from required-up-front to just-in-time.** It is never walled at the start; the prompt
lives at the lap-ingest point (`LapTimesIngestPanel`, keyed off the scan route's existing per-source
`hasDriverNameSetting`) — a real, Settings-linked block that stays source-aware so it never over-asks a
LiveRC-name-only or manual-results driver.

**Cut:** the home-track step and the tire step (both are picked *during* log-run, so neither can be a
readiness blocker).

**Readiness is derived** (`src/lib/onboarding/server.ts` → `loadOnboardingView`): `hasCar`, `carId`,
`hasTimingIdentity`, `hasSetup`, `hasAnyRun`, `seen`, `dismissed`. The timing predicate moved to
`src/lib/onboarding/timingIdentity.ts` (`hasTimingIdentity` + `getTimingIdentityForUser`), shared by the
card and the lap gate. `src/lib/onboarding/progress.ts` (the 4-step engine), `OnboardingGuideRail`,
`OnboardingResumeCard`, `OnboardingPayoffCard`, `OnboardingIntroCard`, the guide-pulse CSS and every
`data-guide` anchor are **deleted**.

### How to test it (added 2026-07-26)

Onboarding is the one flow you can't re-experience on your own account: the admin reset only clears
`onboardingSeenAt` / `onboardingResumeDismissedAt`, but both gates *also* read `hasCar` / `hasAnyRun`,
so on an account with data a reset shows you nothing. That is why reviewing a copy tweak used to mean
creating a throwaway account. Two surfaces now cover it:

- **`/debug/onboarding-preview`** (dev only, `notFound()` in production) — every first-run state
  through the **real** `WelcomeScreen` and `DashboardGetSetUpCard` with fabricated props: empty,
  overlay-answered, car-only (green-lit *and* hand-build chassis), car+timing, car+setup, ready,
  first-run-logged, ignored. `window.fetch` is stubbed for `/api/onboarding` only, so Ignore and the
  welcome buttons behave exactly as they ship but write nothing to your account.
- **`npm run test:onboarding`** — `src/lib/onboarding/visibility.ts` holds the gates as pure
  functions (`showWelcomeScreen`, `showGetSetUpCard`, `isGarageReady`), consumed by
  `loadOnboardingView` and `DashboardHome` so the tested rule *is* the shipped rule.

**Still needs one drive on a fresh account** (the preview can't fake it): magic-link first sign-in
landing on the dashboard with the overlay up, `seen` persisting across a reload, `/cars` → add car →
the card flipping to the payoff, and the just-in-time timing gate at lap ingest.

**Everything below this section is the retired 2026-07-22 spec, kept for history — the State table,
rollout rows and Code map no longer describe the shipped app.**

---

## One sentence

> Get the garage ready first, so logging the first run takes seconds instead of ages — and never
> let a new driver reach a screen that can't finish.

## The problem

There is no onboarding of any kind, and the empty account is worse than bare — it is broken. The
dashboard's loudest button (`DashboardStartRunCta` → `/runs/new`) drops a car-less user into the
full six-step log-run wizard, where all six tabs walk, the bar keeps promising "Tires →", and Save
is silently disabled. See the dead-end table below.

---

## Locked decisions (founder interview 2026-07-22)

| Decision | Call |
|---|---|
| **Shape** | A **full-screen set-up wizard** after first sign-in, whose job is to get the *garage* ready — explicitly **not** to log the run. Then a **lighter guide** through the first log-run. Rejected: checklist-only, and log-run-wizard-only with no set-up phase. |
| **Why two phases** | Founder: *"it feels more natural to get ready for the first run rather than logging the first run taking ages."* The set-up wizard front-loads the one-time work so the first run is a walk, not a form. |
| **Set-up steps** | Welcome → You (name + timing name) → Your car → Your track → **Garage ready**. Four progress dots; the welcome screen sits outside the count. |
| **Timing identity** | Asked **up front and REQUIRED** (founder 2026-07-22, reversing "optional"): the name as the timing site prints it **and** the transponder number. Nothing else in the app matters if lap times can't find the driver — hand-typing laps is what this app exists to remove. Next stays disabled until both are in. Drivers on a **club / loaner chip** tick "the number changes" instead of a number and are matched on name alone, so nobody is trapped. Writes `liveRcDriverName` (Speedhive falls back to it) + `speedhiveTransponderNumbersJson` / `speedhiveTransponderLoanerAt`. There is no "Skip for now" on this step. |
| **Unknown chassis** | Free-text it, **create the car immediately, log runs today**, and **ping the founder** to add the chassis type + build its sheet. Never make a new user pick "the closest match" — that pollutes aggregations with a lie. They start on the generic touring sheet. |
| **Setup sheet** | **Not a step at all** (founder 2026-07-22, reversing "optional and skippable"): almost no chassis has a green-lit calibration, so an upload here means hand-building the whole sheet before the driver has logged anything. Nothing in the wizard mentions sheets, and the chassis picker shows **no calibration badge** — it read as a warning about something a new driver can't act on, and the old one counted other people's unverified calibrations, so it promised reads that wouldn't happen. |
| **Where the sheet ask lives instead** | A **dashboard card, under the run CTA, with no Ignore button** — it appears as soon as they have a car (not gated on run 1) and retires itself the moment a setup exists. Founder: a setup is where the real value is, so it gets asked for *in the app*, not during set-up. Suppressed while the resume card is up: one nag at a time. The action is the Garage hub's own `UploadSetupSheetBar`, so the car picker, the read-a-sheet doors and the fill-it-in fallback all come for free. **Amended 2026-07-29:** briefly folded into a permanent Setups card that listed what each car was running; that list was retired the same week (the reworked Garage leads there) and the ask is its own card again — `DashboardAddSetupCard` (`lib/setup/getDashboardSetups.ts`). Same copy, same position, still no Ignore button, still self-retiring once a setup exists. See `DASHBOARD_NORTH_STAR.md`. |
| **"Garage ready" screen** | **Kept** — it is the payoff. Car / track with ticks, then "Log your first run". The hand-off is deliberate, not automatic. |
| **In-run guide** | **G1 — slim coach line.** One quiet line under the recap on every step, worded per step ("tires aren't required to save"). Rejected: one-time dismissible tip card (G2), and no copy at all (G3). |
| **Inline creation** | The log-run wizard gains **＋ New car / ＋ New track / ＋ New tire set** rows so nothing sends a driver out of the flow. This is backlog **FB-01 / FB-02** and benefits every returning user, not just day one. |
| **Skippable** | Yes — "I'll look around first" — **except the timing step**, which has no skip link. Progress is resumable either way. |
| **Resume card** | Kept on the dashboard (meter + remaining rows + yellow "Pick up where I left off"), **and dismissible** — founder: *"keep it but able to click ignore."* Dismissing hides it for good; it also disappears on its own once the garage is ready. |
| **Audience** | One flow that degrades gracefully: invited testers get their chassis and home track pre-filled and **confirm** rather than answer; strangers get the honest unknown-chassis path. |

---

## The dead ends this replaces

Found by a full zero-data sweep of every surface, 2026-07-21. Phase 1 fixes all of them and is
independent of the design above.

| # | Where | What happens today |
|---|---|---|
| 1 | `/runs/new`, zero cars | `LogRunWizardHost` does `entryCars[0]?.id ?? ""` with no guard. Six tabs walk, Save is disabled with no label saying why, and the one card that explains it scrolls off the top. Reached from the dashboard's primary CTA and the mobile FAB. |
| 2 | `/setup` → new upload, zero cars | The button is enabled and un-annotated; **PDFs bypass the car check entirely** and upload with `carId = null`. Images error only *after* the file is picked. |
| 3 | `/cars/new/setup` | Redirects to the **global chassis-type** authoring wizard (needs an editable AcroForm PDF). It is not "add my car". |
| 4 | `/engineer` | Answers happily with an empty run log. No nudge to log a run first, so the user burns a request discovering the tool needs data. |
| 5 | Nav vs page title | Nav says **Garage**, the page says **Assets**, `/garage` redirects to `/assets`. |
| 6 | `src/app/assets/batteries/`, `src/app/assets/tire-sets/` | Empty directories → 404. Batteries were removed app-wide and have no UI. |

**The pattern to copy for every zero-data state:** `UploadSetupSheetBar.tsx` — pre-emptive (not a
post-hoc error), explains the dependency in one line, and offers a working link to fix it.

---

## State

No migration. `AppSetting` (`src/lib/appSettings.ts`) is a per-user key/value store; onboarding
flags live there beside `myName` and `currentPracticeDayUrl`.

| Key | Meaning |
|---|---|
| `onboardingCompletedAt` | ISO timestamp. Absent = the set-up wizard has not been finished. |
| `onboardingSkippedSteps` | JSON array. Legacy: it recorded a skipped setup-sheet step, which no longer exists. Kept because old accounts have `["sheet"]` stored; nothing writes it now. |
| `onboardingResumeDismissedAt` | ISO timestamp. Set when they tap Ignore on the dashboard resume card; the card never returns. |
| `speedhiveTransponderLoanerAt` | ISO timestamp. The driver declared a club / loaner chip, which satisfies the required transponder field. Cleared automatically the moment a real number is saved. |

Derived progress (`src/lib/onboarding/progress.ts`) has four steps — **name, timing, car, track** —
each read from what the driver actually has, never a stored counter. The timing step is done only
when there's a timing name **and** (a transponder number **or** the club-chip declaration).

Read alongside the existing dashboard server model so no extra round trip is added.

---

## Rollout status

| Phase | Scope | Status |
|---|---|---|
| **0** | Artifact prototype + founder interview → this doc | ✅ 2026-07-22 |
| **1** | The six dead ends above | ✅ built 2026-07-22, **not yet driven in a browser** |
| **2** | Onboarding state + the set-up wizard (5 screens) | ✅ built 2026-07-22, **not yet driven in a browser** |
| **3** | G1 coach line, inline ＋ New track, dismissible resume card | ✅ built 2026-07-22, **not yet driven in a browser** |
| **4** | Sheet step removed; dashboard "add a setup" card takes over | ✅ built 2026-07-22, **not yet driven in a browser** |

Built, typechecked and unit-tested — but nothing here has been exercised as a real empty account
yet (the dev DB is production, so a throwaway allowlisted user is needed). Treat every row as
unverified until that happens. An in-run "＋ New car" row is still open (FB-01).

**Code map:** `src/app/welcome/page.tsx` + `src/components/onboarding/WelcomeWizardClient.tsx` ·
`src/components/onboarding/OnboardingResumeCard.tsx` · `src/lib/onboarding/{progress,server}.ts`
(+ `progress.test.ts`, `npm run test:onboarding`) · `src/app/api/onboarding/route.ts` ·
`firstRunCoachLine()` in `src/lib/runs/wizardWalk.ts` ·
`src/components/runs/InlineNewTrackRow.tsx` ·
`src/components/dashboard/DashboardAddSetupCard.tsx` + `src/lib/setup/getDashboardSetups.ts`.

Update this table as work lands — a spec is intent, not shipped code (`docs/NOT_YET_BUILT.md`).

---

## Non-goals

| Not the goal | Why |
|---|---|
| A second wizard chrome | The log-run wizard's F2 bar stays the only in-run chrome. The set-up wizard is a separate, simpler surface that ends before logging begins. |
| Blocking anyone on a setup sheet | Logging is pillar #1. The sheet sharpens answers; it never gates a run — which is also why it isn't a wizard step. |
| Forcing a catalog chassis | A wrong chassis is worse than an unknown one — it silently mis-buckets community aggregations. |
| A tour or coachmarks | Rejected in favour of doing the work with the driver, then one quiet line per step. |
