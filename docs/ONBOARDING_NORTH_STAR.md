# Onboarding North Star — first run, first day

**Status:** ⚠️ **Partly superseded — see "Amendment 2026-08-26" (current), "Amendment 2026-08-18" and "Reversal 2026-07-23" below.** The guide chip, the derived
4-step progress, the resume/payoff/intro cards and the required-up-front timing step were retired after
the founder drove the empty account and found the chip dead-clicked, forced steps, and didn't teach.
Original spec (2026-07-22, 2 rounds over an artifact board) kept below for history. **Owner:** Jordan.
Prototype: https://claude.ai/code/artifact/7e5cd6ad-73fa-4a41-98d9-eb2e92315e7d

Governs what a brand-new account sees, from first sign-in to their first complete run. Sits under
`PRODUCT_NORTH_STAR.md` (pillar 1 — lap-time ingestion / session capture; nothing matters if the
first run never gets logged). Visual work on these screens follows `VISUAL_NORTH_STAR.md`.

---

## Amendment — 2026-08-26 (current model): three steps, and the dashboard is the hub

Founder drove a brand-new account end to end. The welcome screen and the add-car flow were called
good and are untouched. Four things were not.

### 1. The car flow hands back to the dashboard, not to the next step

`CarList`'s first-car confirmation pointed straight at `/settings`. It now points at **`/`**, still
worded **"Continue setting up"**.

The 08-18 rule that the two surfaces "must never disagree about what comes next" is satisfied a
better way: the car page no longer has an opinion. It hands back, and the Get-set-up card — which is
already sitting in its "Add your timing details" state when they land — owns the order. One checklist,
one place. The extra tap buys the driver watching their own list tick over, which is the only reward
the step has.

The 2026-08-13 finding it must not undo: adding a car used to leave people stranded on the Garage
page with no message and nothing pointing onward. Pointing onward is preserved; only the destination
moved.

### 2. Settings has a way out

Settings is the one step of the walk that lives off the dashboard, and once you were on it nothing
said you were finished or where to carry on. The bottom dock's Dashboard tab is furniture — it reads
as "go elsewhere", not "the rest of what you started is waiting".

It renders on `showGetSetUpCard(onboarding)` — the same predicate as the dashboard card, so there is
no second definition of "still setting up" to drift, and it is on screen from the moment they arrive
rather than after a save (founder: the complaint was about being stranded on the page, which is true
before anyone types anything). For everyone else Settings is exactly the page it has always been.

### The hand-off bar — one component, both places

Items 1 and 2 are the same moment twice: finished here, the next thing is elsewhere. They are now
literally the same component, `SetUpHandoffBar`, and `direction` is the only difference — the Garage
bar goes forward, the Settings bar goes back.

**Yellow, pinned at the top, and it stays there through the scroll** (founder 2026-08-26, in three
passes: yellow and sticky on Settings first, then the same material on the Garage, then the same
*position* there too). All of it matters. Settings is long enough that an in-flow row is gone by the
time anyone finishes typing their transponder; the Garage's used to be a grey explanatory line above
a `self-start` chip, which said one thing in two elements, did not read as the way on, and scrolled
away the moment the driver looked at their new car. Standard `primary` face — no bespoke yellow and
no rim (see the 2026-08-25 note over `.primary-face`) — destination bold, reason under it at 75%,
arrow on the far side.

Neither obvious technique can pin it, and both dead ends are already documented elsewhere in the
tree: `.app-shell` is `overflow-x: hidden`, so the spec computes `overflow-y` to `auto` and the shell
becomes a scrollport that never scrolls — a `position: sticky` child pins to a box that stays still
and scrolls away with the page (`TopRail`, `SetupEditorSaveBar`, `SessionsBrowser` all carry the
finding); and `position: fixed` inside that shell is clipped on iOS, which is why `BottomNav`,
`MobileBrandMark` and `AccountMenu` are mounted outside it. So the bar **portals to `document.body`**.
Each page keeps ownership of who is mid-walk — only the pixels move — which beats a mount point in
`AppShell` that would have to re-derive that client-side.

**It measures the page rather than describing it.** Only the vertical offset is in `globals.css`
(`.setup-handoff-bar`), because only that is knowable: it clears the 34px corner pills at
`--top-chrome-y` on the phone — BELOW the band, never in it, since `MobileTitleCondenser` fades the
compact title into that same band — and the 64px `.top-rail` from md up. Everything else the
component reads off the live DOM, because every guess was wrong on one of the two pages:

- **The column is not `.page-body`.** Settings is a centred `max-w-2xl` section; the Garage is a
  full-bleed section with a `max-w-2xl` wrapper inside it, and on desktop no page header at all
  (`.page-header.is-echo` collapses — the rail's tab names the page). Measuring the section gave a
  1344px yellow bar over 670px of cards. It measures `.page-body`'s first element child.
- **The room to reserve is not the bar's height.** The bar's top lands above where `.page-body`
  starts, by a different amount per page, so what has to be reserved is how far it reaches *past*
  that. Padding moves a section's content, never its box top, so re-measuring is stable rather than a
  feedback loop. `--setup-handoff-pad`, applied under `body.has-setup-handoff`.

Measured at 390px and 1440px, both pages: the first card lands 11.9–12.4px under the bar, against
the 12px every other card gap runs at.

### 3. "Log your first run" is off the card

The 08-18 payoff state put a yellow **Log your first run** button directly beneath the dashboard's
yellow Start-a-run bar. Two yellow buttons, one job. The bar is the run door and always was.

### 4. The setup sheet is step three, not a footnote

It rode along under **"Optional"** / **"Make it better"**, which is exactly how it read. Founder:
*"it's not 'make it better', it's add it now or add it when you're logging a run."* Both labels are
deleted.

**The card now walks CAR → TIMING → SETUP.** Three states:

| State | Eyebrow | Headline | Primary action | Also |
|---|---|---|---|---|
| No car | Get set up | "Add your car to log your first run" | — (three rows) | sheet row is the third row, unlabelled |
| Car, no timing | Get set up | "Add your timing details" | **Continue setting up** → `/settings` | sheet row under **"After that"** |
| Car + timing | **Last step** | **"Add your setup sheet"** | `UploadSetupSheetBar` | quiet deferral link |

**Every headline is the ask and nothing else** (founder, same day, two passes). The middle one read
"Car's in — timing next", which put the finished step first so the eye landed on what was already
done; then "Timing next — car's in", which still spent half a headline congratulating them. The car
is acknowledged by the car page's own confirmation and by nothing on this card. All three states now
name the step the way the rows do.

The deferral is a real door and its promise is true: *"Or add it when you log a run — the run form
asks for it"* → `/runs/new`, whose setup step carries the same upload plus write-from-scratch. It is
quiet text, not a second yellow button — that is the thing item 3 just removed.

**What has NOT changed: the sheet still gates nothing.** The 08-18 reasoning stands — it is the one
item needing something the driver may not have on them, and on an uncalibrated chassis it is a 36–40
box hand-build. Promotion is about how it reads, not about locking anyone out. `isReadyToRun`
(car + timing) is untouched.

### Rule change in `src/lib/onboarding/visibility.ts`

New **`isSetUpComplete`** (car + timing + sheet), and `showGetSetUpCard` retires on it as well as on
the first run and Ignore. This restores the exit removed on 08-18, for the reason that removal is now
moot: back then the complete card carried the payoff button, so retiring deleted the good news at the
moment it arrived. With that button gone, a complete card shows three ticks and asks for nothing.
Two questions, both wanted, deliberately not one predicate:

- `isReadyToRun` — can this driver log a run that will work? The sheet does not affect it.
- `isSetUpComplete` — have we finished asking? The sheet does.

`/debug/onboarding-preview` shows both verdicts per scenario.

---


## Amendment — 2026-08-18 (superseded in part by 2026-08-26 above): the car is not the payoff

The 07-23 reversal made a **car** the only thing gating the payoff, so adding one flipped the card
straight to "You're ready — log your first run". Driven again by the founder: that is both premature
and **untrue**.

- With no **timing identity**, lap times do not attach to the driver. They can log the run, but every
  lap has to be typed in by hand — the exact chore the app exists to remove.
- The run wizard then **refused them anyway**: completing a run needs a car rating *and* one
  populated setup field, so "you're ready" was followed by a refusal two screens later. This was
  finding #2 of the 2026-08-13 friction audit and had been live the whole time.

**The card now walks CAR → TIMING, then hands over the run.** Three states:

| State | Headline | Yellow button | Also |
|---|---|---|---|
| No car | "Add your car to log your first run" | — (three rows) | unchanged |
| Car, no timing | "Car's in — one thing left" | **Continue setting up** → `/settings` | setup row under "Optional" |
| Car + timing | "You're ready — log your first run" | **Log your first run** | setup row under "Make it better" |

**A setup sheet is deliberately NOT on the path** (founder call, this amendment). It is the one item
needing something the driver may not have on them — the manufacturer's fillable PDF — and for most
chassis the fallback is a 36–40 box hand-build. Putting the app's longest chore before its first
payoff is the version that loses people. It stays as an advised extra and carries on nagging from
`DashboardAddSetupCard` once this card retires.

**Nothing gates.** The dock’s run control is untouched and on screen the whole time, so somebody
standing at the track is never held up by set-up.

**Amended 2026-08-18 (founder), same day:** the yellow button on the middle state reads **“Continue
setting up”**, not the name of the step. Naming the step made timing read as a second chore demanded
after the car; it is the rest of the same one, and the sentence above the button already says what it
is. The card’s own **“Log a run anyway”** link came out on both surfaces (card and `CarList`): the
dock’s run control never leaves the screen, so the link was a second door to the same room, printed
directly under the one thing being asked for — which read as an apology for asking. The wizard’s
“log it anyway” exit below is a different thing and stays.

**Two rule changes** in `src/lib/onboarding/visibility.ts`:

- `isGarageReady` (car + timing + setup) → **`isReadyToRun`** (car + timing).
- `showGetSetUpCard` retires on **the first run or Ignore only** — no longer on readiness. Readiness
  is now the card's payoff state, so retiring on it deleted the good news at the moment it arrived.

**The Garage page agrees with it.** The first-car confirmation in `CarList` (added 2026-08-13 to kill
the two detours every walk paid) led with "Log your first run"; it now leads with **Continue setting
up** → `/settings`, taking `hasTimingIdentity` as a prop from
`src/app/cars/page.tsx`. The two surfaces must never disagree about what comes next.

> **Superseded 2026-08-26:** that button now points at `/` (the dashboard), not `/settings`. The
> disagreement risk is removed rather than managed — the car page stopped having an opinion about
> what comes next, and the Get-set-up card is the only checklist.

### "Log it anyway" — the setup gate has an exit

Completing a run still wants one value on the sheet, and that stays: it is what makes a run worth
comparing. But the refusal now carries its own way out. After a Run-complete attempt is refused on
the setup, the Setup card shows:

> Put one value on the sheet — a tyre compound counts — and this run can be completed.
> **This run doesn't have a setup — log it anyway**
> Laps, tyres and how it felt are all still recorded. The Engineer just won't have a setup to
> suggest changes from.

- It appears **only after a refusal**, so nobody who was going to fill the sheet in ever meets it.
- It sits in the **Setup card**, not with the other validation copy in Feedback — a setup-only
  refusal scrolls the driver to the Setup card, so the offer has to be where they are looking.
- The **car rating stays required**. It is one tap and every later comparison hangs off it.
- Implemented as `saveRun(e, "completed", { waiveSetup: true })` — an argument, not state, so the tap
  that waives is the tap that saves and nothing sticky survives into the next run.
- No schema change: `Run.setupSnapshotId` is already non-null and the snapshot's `data` is already
  allowed to be empty (every wizard draft saves that way).
- The run then reads **"No setup recorded for this run — it was logged without one"** in place of the
  "Setup vs previous run" diff (`RunDetailPanel`). Without that case the diff reported every field of
  the previous run as changed, which is the opposite of what happened.

---

## Reversal — 2026-07-23 (superseded in part by the amendment above)

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

**The track's own timing site is the other half of that gate** (added 2026-08-05).
`TrackTimingSourceNotice` heads the URL Auto tab and always names what discovery is pointed at
("Searching Thornhill on LiveRC (tftr.liverc.com)"). A track with no `liveRcUrl`/`speedhiveUrl`
searched nothing while looking exactly like a scan that found nothing — the common case being a
venue *someone else* added to the shared catalog. Timing URLs are an open contribution
(`PATCH /api/tracks/[trackId]` allows any driver), so the notice takes the URL inline and the
changed props re-scan; no trip to the Tracks page mid-run.

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
  functions (`showWelcomeScreen`, `showGetSetUpCard`, `isReadyToRun`), consumed by
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
