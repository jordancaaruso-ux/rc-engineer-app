# Timing sweep — the timing site opens the run, the driver closes it

Founder decisions 2026-09-14 (interview, then "let's push for option 1" — everything before the
1 October launch), revised 2026-09-15 (no mid-day calls; one run per time on track). The code
lives in `src/lib/sweep/`; this is the intent it implements.

## The idea in one line

Nothing used to happen until a driver pressed **Start a run**. Now the timing sites are read once
a day, at 8 pm track time: every session with the driver's transponder (Speedhive) or name
(LiveRC) becomes a run by itself, an open draft gets its laps without the Laps step, and the day
arrives that evening by push or email. During the day the wizard is the way in, and its Laps step
files the rest of the day beside the run being logged. The sweep never competes with a person; it
fills what the person did not do.

## Rulings 2026-09-15

- **No mid-day calls.** "Your day arrived tonight" is the product. The 5/10-minute polling of
  "armed" tracks, the app-open beacon, the run-save arming hook and the mid-day "Run 3 is in"
  push were all deleted, not switched off. Scouting every track a listener has raced would have
  been thousands of calls a day from one address, most of them at empty tracks on a Tuesday, to
  upgrade "your day arrived tonight" to "Run 3 is in" for a driver who never opened the app.
- **One run per time on track.** A track with two timing links posts the same heat twice, and a
  practice feed splits one outing on every pit stop. Sessions are matched by the WINDOW they
  covered on track, never by "started within N minutes". See *Outings* below.
- **Gather, then file.** The evening pass reads every source the track has for every listening
  driver, and only then files each driver's day — so there is no race between sites and nothing
  to undo. The order sources are read in no longer decides anything.
- **A stop shorter than three minutes inside a practice run is a pit stop, not a new run.** A
  driver reviewing their day thinks in outings, not decoder blocks.

## Claiming rules

A timing session is unclaimed until something owns it, in this order:

1. **An open draft claims forward.** A draft (or a logged run saved without laps) at that track
   claims the first unclaimed outing that started after it was opened, oldest draft first, one
   each. Laps attach silently; the draft stays a draft. Undo = the existing "not my session"
   unlink. `planDraftClaims.ts`, `attachSessionToRun.ts`.
2. **The wizard claims by pick** — today's Laps step, unchanged.
3. **Else the sweep files a placeholder** — an unconfirmed run (`Run.unconfirmedAt`, plus
   `filedBySweepAt`) carrying setup/tyres from the nearest earlier logged run that day, or nothing
   at all when nothing was logged. Never across days. `createBackfilledRuns.ts` with a `track`
   context.

**A placeholder is never precious.** A human run that claims its session dissolves it
(`linkImportedSessionsToRun`). A confirmed run is never dissolved.

**The app never guesses the car.** `resolveSweepCar.ts`, in order: the nearest earlier run today
at that track → the transponder's bound car (Settings → "Which car each chip is in") → every run
today at the track in one car → the driver's only car. Otherwise the session is imported LOOSE
(`ImportedLapTimeSession.sweepFiledAt`, `trackId`, no run) and the evening summary asks once.

## Outings — one run per time on track

`src/lib/runs/groupOutings.ts` (pure, tested) and `outingSpan.ts`. Every session becomes a window
on track: its stored time plus its laps. Speedhive race results stamp the LAST crossing, every
other source the start (`timeAnchorFor`); LiveRC times are wall clock read in the track's zone.

- **Windows that overlap are one outing.** The same heat on LiveRC and Speedhive; a practice-loop
  block that ran during a heat; a timed practice session that spans the 5-laps-then-back-out
  fragments the practice feed split it into.
- **Practice fragments closer than a pit stop (`PIT_STOP_GAP_MS`, 3 min) are one outing.** Only
  practice joins practice this way; a block a minute after a heat is the next thing.
- **The official record leads.** Inside an outing a race/heat result is primary — it carries the
  field and the finishing order. Among equals the fuller sheet (more drivers, then more laps).
  The rest are linked to the same run (`ImportedLapTimeSession.linkedRunId`) and never open a run
  of their own; the run's laps stay the primary's.
- **An outing that overlaps a run the driver already has today joins that run.** The sweep never
  opens a second run over a window a person's run already covers.

Both the evening pass (`fileDay.ts`) and the wizard's "Add N other runs from today"
(`createBackfilledRuns.ts`) apply the same rule with the real payloads. The offer sheet counts
outings too (`groupBackfillCandidates`), estimating each window from lap count × best lap, so the
number the driver sees on Saturday afternoon is the number the summary says on Saturday night.

## The evening pass

**Two looks, one summary (founder ruling 2026-09-16).** At 20:00 track time the sweep looks at
the day for every listening driver who raced there in the last 90 days. A driver who has been off
the track since 19:30 gets their summary then. A driver with a session at or after 19:30 is still
racing: their sessions are filed quietly, nothing is sent, and the track owes an 8 am look — which
gathers the night's sessions for the same day and sends the whole day at 08:00 the next morning
(`racedIntoTheEvening`, `QUIET_MINUTES`). Nobody is sent a day twice: the track's document
remembers who was told at 8 pm. Days before yesterday are never looked at.

**Dispatcher and workers (scaling pass, 2026-09-16).** The five-minute tick (`runSweepTick.ts`)
reads the plan, finds every track whose clock is in a window (20:00–20:29 for tonight, 08:00–08:29
for a track that owes last night), **claims each in its own Blob document BEFORE handing it off**,
and POSTs the job to `/api/cron/timing-sweep/track`. That worker answers 202 at once and runs
`runTrackLook` after the response (`after()`), so every track gets its own function and its own
two minutes. A tick hands off at most `DISPATCH_PER_TICK` (25) tracks; the rest stay unclaimed for
the next tick five minutes later, inside the same half-hour window — that number is the ceiling on
how many timing sites are being read at once. A hand-off that fails gives its claim back; a worker
that dies after claiming is not retried that day (the claim is what stops a driver being told
twice).

**Read once per track.** Speedhive practice is one listing call per track (every chip at once,
`gatherSpeedhivePractice`). Speedhive race results are read once per track and matched against
every driver's chip and names in memory, opening only the day's sessions
(`gatherSpeedhiveResults`). LiveRC still crawls per driver, but the hub and race pages are fetched
once per look and shared across drivers (`pageCache`). Nothing is filed until every source has been
read (`trackLook.ts` → `fileDayForUser`).

**Postgres sleeps.** The schedule lives in Vercel Blob (`blobStore.ts`, prefix `sweep/<env>/`,
one store shared by dev and prod): `plan.json` (who listens, at which tracks, on which clock —
rebuilt nightly by `/api/cron/timing-sweep-plan`, patched on a settings save) and
`evening/<trackId>.json` (that track's day: claimed / done / morning-owed, and who was told). A
tick with no track in a window reads the plan and nothing else.

Track clocks: `Track.timeZone` from the pin (`@photostructure/tz-lookup`), set on create/pin,
backfilled by `npm run db:backfill-track-tz`; fallback owner zone, then UTC.

## Who listens

Paid, active tiers only (`getEntitlementFor`); off the day a subscription lapses. Needs a saved
transponder (loaner-flagged excluded) or a LiveRC name. Placeholders count toward Starter's ten.

`SWEEP_LISTENER_EMAILS` (comma-separated) narrows listening to those accounts — beta.jrcdynamics.com
shares production's database, so the beta sweep must only ever act for the beta testers. Unset =
every entitled account (`sweepListeners.ts`, checked in the plan and in `fileDay`).

## Notifications — one, never a nag

- **The evening summary** — the Debrief figures for the day (`buildDebriefRecap`): runs, laps,
  best, top 5, five-minute stint, tyres when more than one, air; what is unconfirmed; what needs a
  car. By push when the driver has any device, else by email (`sendTransactionalEmail`, same SMTP
  as sign-in). Never sent for a day with nothing.

Settings → Notifications is mounted; the shell uses APNs (iOS) and FCM (Android).

## Surfaces

- Dashboard: **"Fill in run 3"** (or "N sessions found · which car?") under the Start-run bar.
- Settings → Timing & results: a car picker per chip.
- Sessions / run page: the unconfirmed ring and Confirm doors from the lap-step backfill.
- The wizard's Laps step: "N other runs from today aren't logged" — N counts outings.

## Import your last runs

Founder call 2026-09-15: a quiet row under the Start-run bar, **Import your last runs** (labelled
"Get my day" until 2026-09-16; the code keeps the old name), for members on a
plan who have a LiveRC name or their own transponder (`canLookUpTimingSessions`, the sweep's
rule, looser than the Get-set-up card's), and not on the read-only demo. Pick a track (the last one raced at is
preselected; only tracks with a LiveRC or Speedhive link are listed) and a day — or a stretch of
days. The app reads the timing sites once per day, for that driver, and files each day as outings
through the same code as the evening pass (`getMyDay.ts` → `fileDayForUser`, trigger `driver`),
then lands on what came in. `/api/sweep/day`, `GetMyDay.tsx`.

- **The day is a calendar, not a short list** (founder 2026-09-16, replacing five pills). **Today**
  and **Yesterday** stay as pills — last night's racing must be one tap — and under them sits the
  shared `DayRangeCalendar`: one tap is a day, a second tap is a range, and it reaches back
  `GET_MY_DAY_REACH_DAYS` = 14 days counting today. Older days are greyed, not hidden. The same
  grid draws the meeting-dates field, so the two calendars cannot drift.
- **A range is one request per day, newest first** (`daysInRange`). Not one request for the
  stretch: a fortnight cannot be read inside a route's two minutes. The button carries the
  progress — "Day 3 of 7 · 9 runs" — and closing the sheet stops it after the day in flight,
  keeping everything already filed. The route still validates one day at a time.
- **A day nobody raced is cheap.** The 35 s crawl only happens where LiveRC has a meeting that
  day; an empty day costs a second or two, which is what makes a fortnight a real option.
- **Where it lands.** One day opens that day in Sessions, where the Debrief lives. A range opens
  Sessions narrowed to that track and those dates (`?trackId=&dateFrom=&dateTo=`) — the runs that
  just came in. Nothing found says so and stays put.
- **One look per tap, no background scanning.** It is the driver asking, so the no-mid-day-calls
  ruling does not apply. Speedhive and LiveRC are read side by side within each day.
- **Safe to press again.** Sessions already on a run are skipped, and a session that overlaps an
  existing run joins it, so a second press after Speedhive catches up only adds what was missing.
- **The car is asked only when the app cannot tell** (never-guess rule), and **once for the whole
  stretch** (founder 2026-09-16) — asked after every day is read, with its reach named on the
  question ("14 runs across 3 days") so a wide answer looks wide. The sheet lists the cars and
  files each day's loose sessions with the one picked, without reading the sites again
  (`fileImportedRowsForUser`). Imported runs land unconfirmed, so a car answered too broadly is
  fixed on the run, not re-imported.
- **Every run in the dates, never the newest few** (founder 2026-09-17: "it should always search
  for every run within the date period the user provides"). A day is a filter over the whole
  history, not a count:
  - **LiveRC races:** every meeting on the track's `/events/` page that could hold the day — listed
    as spanning it, or starting up to 7 days before (or the day after), because club-typed dates
    are not boundaries (SA State Titles 2026 was listed "Sep 11" and ran its qualifiers on the
    12th) — plus the dashboard's current meeting. All of that day's races are opened
    (`resolveRaceEventHubsForDay`, `liveRcEventsThatMayHoldDay`). It used to read only the current
    meeting, so a club that had raced since made last weekend unimportable.
  - **LiveRC practice:** that day's list (`practiceDayYmd`), every row — a titles Friday posted
    323 and a 300-link cap cut the morning.
  - **Speedhive practice:** per transponder over the chip's whole history, or by name walking the
    location's activity list back page by page to the day (`fetchPracticeLocationActivitiesInWindow`)
    — it used to read the newest 20, so at a busy track any day but today was already gone.
  - **Speedhive race results:** every organisation event since 7 days before the day
    (`fetchOrganizationEventsSince`), every session in it — including those nested in
    `subGroups`, which were never read — dated by the track's wall clock
    (`speedhiveSessionTime.ts`).
  - LiveRC is only read when the driver has a LiveRC name: its practice page lists every driver,
    and with nothing to match every one of them would be filed.
- **A short read is said, never passed off as the whole day.** A page, meeting or events list that
  would not load, or race pages the crawl ran out of time for (75 s for a day asked by hand), mark
  that site `incomplete`: the sheet reads "7 runs in · couldn't read all of LiveRC" and stays open
  so the driver can press again, instead of landing on a list that may be short.
- The listener allowlist does not apply (the driver is acting for themselves); entitlement does.
  The 8 pm summary still goes out for the day.

## Cron and env

`vercel.json`: `timing-sweep-plan` at 14:05 UTC nightly, `timing-sweep` every 5 minutes (the
five-minute beat is only so ticks land inside each track's half-hour 8 pm and 8 am windows; needs
Vercel Pro). The tick reaches its worker at `SWEEP_SELF_ORIGIN`, else the project's production
domain on Vercel, else the origin it was called on. Env: `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `TIMING_SWEEP_ENABLED=1` (production
kill switch; a dev server is always live), `SWEEP_LISTENER_EMAILS` (see above), `SWEEP_BLOB_PREFIX`
(required on beta: both Vercel projects report `VERCEL_ENV=production`, so beta sets `beta` to keep
its schedule apart from the main site's), `NEXT_PUBLIC_SENTRY_DSN` for failure reports,
`FCM_SERVICE_ACCOUNT_JSON` for Android push. Dev drive: the fake LiveRC site (`DEMO_TIMING_SITE=1`,
`npm run demo:timing:setup -- --email=<throwaway>`) and
`GET /api/cron/timing-sweep?evening=<trackId>` forces one track's 8 pm look for today and
`?morning=<trackId>` its 8 am look for yesterday (`&ymd=` picks the day, `&dispatch=1` goes through
the worker hand-off the way production does). `scripts/dev-notif-test-day.ts --mode=night` builds a
day still on track at 19:45, so the 8 pm look holds and the 8 am look sends.

## The beta site

`beta.jrcdynamics.com` is a second Vercel project (`rc-engineer-beta`, production branch `beta`)
on the same repo, sharing production's database, Blob store and secrets. It differs by env only:
`AUTH_ONLY_EMAILS` (who may sign in there), `SWEEP_LISTENER_EMAILS`, `TIMING_SWEEP_ENABLED=1`,
`SWEEP_BLOB_PREFIX=beta`, `NEXT_PUBLIC_APP_URL` / `AUTH_URL` = the beta origin. Its first deploy
runs the pending migrations on production, so every migration must stay additive: the main site
keeps serving the old code against the new columns until `main` catches up.

## Not built / owed

- LiveRC is still crawled per driver (the pages are shared, the matching is not); a single crawl
  that names every driver on each page is the next step if a club has many listening drivers.
- The per-tick hand-off cap is a fixed 25; a zone with more than 150 tracks would need a wider
  window or a queue with its own concurrency control.
- The pit-stop gap (3 min) and the window estimate on the offer sheet (laps × best × 1.08) are
  first guesses; check both against a real track that posts to two sites before promising copy.
- A late-posting site: only a track that owed an 8 am look reads the day again, so a LiveRC session
  that appears after 8 pm at a track that was quiet is never matched to the fragments filed that
  night. Small loss, not a duplicate.
- A loose outing (no car) leaves its extra sources loose too; the wizard's pick groups them again.
- A test asserting a quiet tick issues no Prisma query.
- An evening-summary opt-out.
- The import row files every session of the day that is not on a run. A run the driver deleted as
  "not mine" comes back on the next press; for a shared chip the loaner setting is the fix.
- An import press during a pit stop files that run with the laps so far, and a later press
  never refreshes it (the session is already on a run).
- Founder steps: SPF/DKIM/DMARC check in a real inbox, Sentry DSN, `db:backfill-track-tz` on
  prod, Apple Developer / TestFlight, Firebase project + `google-services.json`.
