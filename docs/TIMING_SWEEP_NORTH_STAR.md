# Timing sweep — the timing site finds the run, the driver keeps it

Founder decisions 2026-09-14 (interview, then "let's push for option 1" — everything before the
1 October launch), revised 2026-09-15 (no mid-day calls; one run per time on track) and
2026-09-18 (nothing files itself: the driver ticks what becomes a run). The code lives in
`src/lib/sweep/`; this is the intent it implements.

## The idea in one line

Nothing used to happen until a driver pressed **Start a run**. Now the timing sites are read once
a day, at 8 pm track time. A run the driver opened without laps gets them; a run they logged gets
the second site's copy linked to it; and every time on track they did **not** log is kept as a
list — "N runs you didn't log" — every row ticked, for them to keep or not. Only a tick makes a
run. The day arrives that evening by push or email. During the day the wizard is the way in, and
its Laps step offers the rest of the day beside the run being logged, the same way. The sweep never
competes with a person, and nothing is ever in the log that the driver did not choose.

## Rulings 2026-09-15

- **No mid-day calls.** "Your day arrived tonight" is the product. The 5/10-minute polling of
  "armed" tracks, the app-open beacon, the run-save arming hook and the mid-day "Run 3 is in"
  push were all deleted, not switched off. Scouting every track a listener has raced would have
  been thousands of calls a day from one address, most of them at empty tracks on a Tuesday, to
  upgrade "your day arrived tonight" to "Run 3 is in" for a driver who never opened the app.
- **One run per time on track.** A track with two timing links posts the same heat twice, and a
  practice feed splits one outing on every pit stop. Sessions are matched by the WINDOW they
  covered on track, never by "started within N minutes". See *Outings* below.
- **Gather, then place.** The evening pass reads every source the track has for every listening
  driver, and only then places each driver's day — so there is no race between sites and nothing
  to undo. The order sources are read in no longer decides anything.
- **A stop shorter than three minutes inside a practice run is a pit stop, not a new run.** A
  driver reviewing their day thinks in outings, not decoder blocks.

## Ruling 2026-09-18 — nothing files itself

"It shouldn't auto import anything. It should just list the ones you missed — 'want to import the
ones you didn't?' — or, if you didn't do the whole day, list everything with a checkbox for the
ones you don't want. That way it's never 'how did this end up here'."

This reverses the 31 Aug "runs log themselves" and 14 Sep placeholder rulings. There is no
placeholder run any more, and no minimum lap count: a two-lap shakedown is a row the driver
unticks, not a rule the app applies. What the app still does on its own is complete a run the
driver already made — laps onto a draft or lap-less run they opened, a second site's copy linked
onto a run they logged — because that run is theirs and the sheet only closes it.

## Claiming rules

A timing session is unclaimed until something owns it, in this order:

1. **A run the driver already has for that time on track hosts it.** An outing whose window
   overlaps a run of theirs that day (logged by hand, or one they ticked earlier) joins that run as
   a linked source; the run's laps stay its own. Never a second run over a window a person's run
   covers.
2. **An open draft claims forward.** A draft (or a logged run saved without laps) at that track
   claims the first unclaimed outing that started after it was opened, oldest draft first, one
   each. Laps attach silently; the draft stays a draft. Undo = the existing "not my session"
   unlink. `planDraftClaims.ts`, `attachSessionToRun.ts`.
3. **The wizard claims by pick** — today's Laps step, unchanged.
4. **Else it stays LOOSE** (`ImportedLapTimeSession.sweepFiledAt`, `trackId`, `sweepChipCode`,
   no run) and is listed — the "runs you didn't log" sheet, one row per outing, every row ticked.
   A tick makes it a run (`logChosenOutingsForUser` → `createBackfilledRuns`, stamped
   `unconfirmedAt` + `filedBySweepAt` like a lap-step backfill: laps in, setup not yet). An
   untick puts it away (`detectionPromptDismissedAt`): no read offers it again, and it never
   becomes a run. "Not now" leaves the rows waiting.

**The app never guesses the car.** `resolveSweepCar.ts`, most deliberate first (founder
2026-09-17): the transponder's bound car (Settings → "Which car each chip is in") → the nearest
earlier run today at that track → every run today at the track in one car → the driver's only
car. A row the app can place shows its car; a row it cannot has none, and the sheet asks once —
"Which car?" — for those rows only, when the driver logs them.

**The driver's own answers teach the pairing** (2026-09-17). "Which car?" answered for runs found
by one chip pairs that chip with that car. A session found by a chip that joins a run logged by
hand pairs an unpaired chip silently; if the chip is paired with a DIFFERENT car the chip has
probably moved, and the next "Import your last runs" asks once — "In <new car> now" / "Still in
<old car>" (`transponderMoved.ts`, `/api/sweep/chip-moved`). "Still in" is remembered and never
asked again for that chip and car.

**An unconfirmed run is still never precious.** A human run that claims its session dissolves it
(`linkImportedSessionsToRun`, `absorbSameOutingRuns`). A confirmed run is never dissolved.

## Outings — one run per time on track

`src/lib/runs/groupOutings.ts` (pure, tested) and `outingSpan.ts`. Every session becomes a window
on track: its stored time plus its laps. Speedhive race results stamp the LAST crossing, every
other source the start (`timeAnchorFor`); LiveRC, MyRCM and Speedhive race-result times are the
track's wall clock stored as-if-UTC, read in the track's zone. Speedhive's practice loop alone sends
real instants.

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
  opens a second run over a window a person's run already covers. "Today" means the day the run
  was on track (`Run.sessionCompletedAt`), not only the day it was written: a Saturday heat logged
  on Sunday from a MyRCM PDF still hosts Saturday's Speedhive copy.

Both the evening pass (`fileDay.ts`) and the wizard's "Add N other runs from today"
(`createBackfilledRuns.ts`) apply the same rule with the real payloads. The offer sheet counts
outings too (`groupBackfillCandidates`), estimating each window from lap count × best lap, so the
number the driver sees on Saturday afternoon is the number the summary says on Saturday night.
The sheet leaves out the run's own race when a second site posted it (`withoutRunsOwnOutings`).

**When the driver logs the race themselves (added 2026-09-17).** The same rule, the other way
round — Speedhive filed at 8 pm, the MyRCM PDF logged after:

- **On the lap step, a second site's copy is linked, not joined** (`lapImport/sameOutingBlocks.ts`).
  Joining imports is for a run split by a break, whose halves only touch at the break. Two imports
  that share at least half of the shorter window (`sameTimeOnTrack`, stricter than the evening
  pass's overlap) are the same race: the official record takes the laps, the other rides along as
  a linked source ("MyRCM + Speedhive" on the strip), and joined they would have counted every lap
  twice. A MyRCM PDF the driver uploads always takes the laps. Reopening a run brings a linked
  session back as a copy, not as laps, whenever it supplied none of the run's saved lap sets.
- **The save folds an app-made run over the same race into the driver's run**
  (`runs/absorbSameOutingRuns.ts`, from `POST/PUT /api/runs`). Same track, same time on track,
  still unconfirmed: its sessions move onto the driver's run as linked sources and it is deleted.
  A confirmed run is never touched, nor an unconfirmed one the driver wrote notes, a rating or
  handling on.
- **Both judge the track's own clock, never the phone's** (`lapImport/trackClock.ts`, founder
  2026-09-17: "they all post local time, can't we just use that?"). Every timing site posts the
  track's local time — LiveRC and the MyRCM PDF with no zone, Speedhive's race results zoneless
  (the schedule and every lap crossing, checked live), Speedhive's practice loop as a real instant
  with the track's offset on it ("12:37:34.844+02:00"), which the import now keeps
  (`sessionUtcOffsetMinutes` in the stored parse). One race reads the same track time on every
  site, so a driver who flew home before logging the meeting gets the same answer as one in the
  pits. Only a practice import saved before offsets were kept needs a zone; the one-off
  `npm run db:backfill-speedhive-offsets` gives each its track's (never a phone's), and until it has
  run on a database those fall back to the phone's zone.

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

Track clocks: `Track.timeZone` from the pin (`@photostructure/tz-lookup`), set whenever the pin is
set — by hand, from the LiveRC address or typed town, or by two drivers' phones
(`trackLocationFill.ts`, 2026-09-17) — backfilled by `npm run db:backfill-track-tz`; fallback owner
zone, then UTC.

## Who listens

Paid, active tiers only (`getEntitlementFor`); off the day a subscription lapses. Needs a saved
transponder (loaner-flagged excluded) or a LiveRC name. Runs the driver ticks count toward
Starter's cap like any run they log; rows on the sheet do not.

`SWEEP_LISTENER_EMAILS` (comma-separated) narrows listening to those accounts — beta.jrcdynamics.com
shares production's database, so the beta sweep must only ever act for the beta testers. Unset =
every entitled account (`sweepListeners.ts`, checked in the plan and in `fileDay`).

## Notifications — one, never a nag

- **The evening summary** — the Debrief figures for the day (`buildDebriefRecap`): runs, laps,
  best, top 5, five-minute stint, tyres when more than one, air; what is unconfirmed; and how many
  runs on the timing sheet the driver did not log ("2 not logged"). It counts every run the driver
  has that day, however it got there — a driver who logged every run still gets the recap. Never a
  question in the notification (2026-09-16): tapping it opens the sheet listing the runs not
  logged, over the day when they have runs there, over the dashboard when not (`?unlogged=`). By
  push when the driver has any device, else by email (`sendTransactionalEmail`, same SMTP as
  sign-in). Never sent for a day with nothing.

Settings → Notifications is mounted; the shell uses APNs (iOS) and FCM (Android).

## Surfaces

- Dashboard: **"N runs you didn't log"** under the Start-run bar — the sheet, one track and day
  at a time, oldest first. Times on track, not sessions.
- Settings → Timing & results: a car picker per chip.
- Sessions / run page: the unconfirmed ring and Confirm doors, for runs made from the sheet and
  from the lap-step backfill alike.
- The wizard's Laps step: "N other runs from today aren't logged" — N counts outings, every row
  ticked, untick to leave one out (`BackfillOfferSheet`). Same shape as the evening sheet.

## Import your last runs

Founder call 2026-09-15: a quiet row under the Start-run bar, **Import your last runs** (labelled
"Get my day" until 2026-09-16; the code keeps the old name), for members on a
plan who have a LiveRC name or their own transponder (`canLookUpTimingSessions`, the sweep's
rule, looser than the Get-set-up card's), and not on the read-only demo. Pick a track (the last one raced at is
preselected; only tracks with a LiveRC or Speedhive link are listed) and a day — or a stretch of
days. The app reads the timing sites once per day, for that driver, and places each day as outings
through the same code as the evening pass (`getMyDay.ts` → `fileDayForUser`, trigger `driver`).
**It files nothing** (2026-09-18): what is not on a run comes back as the list — "N runs you didn't
log", a row per outing with its time, laps, best and car, every row ticked, grouped by day when
more than one was read — and **Log them as N runs** makes the ticked ones (`logChosenForDay`, one
call per day) and puts the unticked away. Then it lands on what came in. When everything found was
already on a run, or only filled in a draft, it lands straight away — there is nothing to choose.
`/api/sweep/day`, `GetMyDay.tsx`.

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
- **Safe to press again.** Sessions already on a run are skipped, a session that overlaps an
  existing run joins it, and a row the driver unticked stays put away, so a second press after
  Speedhive catches up only lists what was missing.
- **The car is asked only when the app cannot tell** (never-guess rule), and **once for the whole
  stretch** (founder 2026-09-16) — asked when the driver logs the list, only if a ticked row has
  no car, with how many it covers on the question. The answer applies to those rows; a row with a
  car keeps it. Logged runs land unconfirmed, so a car answered too broadly is fixed on the run,
  not re-imported.
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
day still on track at 19:45, so the 8 pm look holds and the 8 am look sends. Its loose rows are
what the "runs you didn't log" sheet lists.

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
- A run's own clock time and its weather hour are still worked out in the phone's zone when the
  run is saved (`resolveRunSessionCompletedAtFromUpsertBody`, `importedSessionWeatherInstantIso`).
  Matching no longer depends on them, but a race logged from another zone is stamped hours off
  and fetches the wrong hour's weather. Open-Meteo can take the track's local time with its
  location, which would make both zone-free.
- `db:backfill-speedhive-offsets` has run on scratch-dev (2026-09-17), not on production.
- A test asserting a quiet tick issues no Prisma query.
- An evening-summary opt-out.
- A run the driver DELETED (rather than unticked) comes back as a row on the next press; for a
  shared chip the loaner setting is the fix. Unticked rows stay away.
- An import press during a pit stop files that run with the laps so far, and a later press
  never refreshes it (the session is already on a run).
- Founder steps: SPF/DKIM/DMARC check in a real inbox, Sentry DSN, `db:backfill-track-tz` on
  prod, Apple Developer / TestFlight, Firebase project + `google-services.json`.
