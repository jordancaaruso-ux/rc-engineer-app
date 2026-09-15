# Timing sweep — the timing site opens the run, the driver closes it

Founder decisions 2026-09-14 (interview, then "let's push for option 1" — everything before the
1 October launch). The code lives in `src/lib/sweep/`; this is the intent it implements.

## The idea in one line

Nothing used to happen until a driver pressed **Start a run**. Now the timing sites are read on a
clock: a session with the driver's transponder (Speedhive) or name (LiveRC) becomes a run by
itself, an open draft gets its laps without the Laps step, and the day arrives that evening by push
or email. The wizard is untouched — the sweep never competes with a person; it fills what the
person did not do.

## Claiming rules

A timing session is unclaimed until something owns it, in this order:

1. **An open draft claims forward.** A draft (or a logged run saved without laps) at that track
   claims the first unclaimed session that started after it was opened, oldest draft first, one
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

## Polling

Poll **tracks**, not drivers — Speedhive's practice listing shows every chip at a track. A track
is **armed** for the rest of its local day when: a run or draft is saved there, the dashboard
opens with it as today's track (`SweepArmBeacon` → `POST /api/sweep/arm`), or a listening chip
appears in its listing. Armed: Speedhive every 5 min, LiveRC every 10 min. Unarmed: one
**evening pass** per track at 20:00 track time across drivers who raced there in the last 90 days.
Today only, no look-back. Per-track exponential back-off on a 429.

**Postgres sleeps.** The schedule lives in Vercel Blob (`blobStore.ts`, prefix `sweep/<env>/`,
one store shared by dev and prod): `plan.json` (who listens, at which tracks, on which clock —
rebuilt nightly by `/api/cron/timing-sweep-plan`, patched on a settings save) and
`armed/<trackId>.json`. A quiet tick reads Blob and nothing else.

Track clocks: `Track.timeZone` from the pin (`@photostructure/tz-lookup`), set on create/pin,
backfilled by `npm run db:backfill-track-tz`; fallback owner zone, then UTC.

## Who listens

Paid, active tiers only (`getEntitlementFor`); off the day a subscription lapses. Needs a saved
transponder (loaner-flagged excluded) or a LiveRC name. Placeholders count toward Starter's ten.

`SWEEP_LISTENER_EMAILS` (comma-separated) narrows listening to those accounts — beta.jrcdynamics.com
shares production's database, so the beta sweep must only ever act for the beta testers. Unset =
every entitled account (`sweepListeners.ts`, checked in the plan, the arm route and `fileSession`).

## Notifications — two, never a nag

- **"Run 3 is in · Best 14.213"** while a track is armed for that driver (`notifyRunFiled.ts`).
- **The evening summary** — the Debrief figures for the day (`buildDebriefRecap`): runs, laps,
  best, top 5, five-minute stint, tyres when more than one, air; what is unconfirmed; what needs a
  car. By push when the driver has any device, else by email (`sendTransactionalEmail`, same SMTP
  as sign-in). Never sent for a day with nothing.

Settings → Notifications is mounted again; the shell uses APNs (iOS) and FCM (Android).

## Surfaces

- Dashboard: **"Fill in run 3"** (or "N sessions found · which car?") under the Start-run bar.
- Settings → Timing & results: a car picker per chip.
- Sessions / run page: the unconfirmed ring and Confirm doors from the lap-step backfill.

## Cron and env

`vercel.json`: `timing-sweep-plan` at 14:05 UTC nightly, `timing-sweep` every 5 minutes (needs
Vercel Pro). Env: `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `TIMING_SWEEP_ENABLED=1` (production
kill switch; a dev server is always live), `SWEEP_LISTENER_EMAILS` (see above), `SWEEP_BLOB_PREFIX`
(required on beta: both Vercel projects report `VERCEL_ENV=production`, so beta sets `beta` to keep
its schedule apart from the main site's), `NEXT_PUBLIC_SENTRY_DSN`
for failure reports, `FCM_SERVICE_ACCOUNT_JSON` for Android push. Dev drive: the fake LiveRC site
(`DEMO_TIMING_SITE=1`, `npm run demo:timing:setup -- --email=<throwaway>`) and
`GET /api/cron/timing-sweep?evening=<trackId>` forces one track's evening pass.

## The beta site

`beta.jrcdynamics.com` is a second Vercel project (`rc-engineer-beta`, production branch `beta`)
on the same repo, sharing production's database, Blob store and secrets. It differs by env only:
`AUTH_ONLY_EMAILS` (who may sign in there), `SWEEP_LISTENER_EMAILS`, `TIMING_SWEEP_ENABLED=1`,
`SWEEP_BLOB_PREFIX=beta`, `NEXT_PUBLIC_APP_URL` / `AUTH_URL` = the beta origin. Its first deploy
runs the pending migrations on production, so every migration must stay additive: the main site
keeps serving the old code against the new columns until `main` catches up.

## Not built / owed

- Speedhive **race results** are read only in the evening pass (per-session classification
  fetches are too heavy for the 5-minute poll).
- LiveRC is polled per armed driver (three per tick); a track-level crawl shared across drivers is
  the next step if a club has many listening drivers.
- Speedhive's practice-feed lag is unmeasured; measure on a club night before promising "run is
  in" timing in copy.
- A test asserting a quiet tick issues no Prisma query.
- An evening-summary opt-out.
- Founder steps: Vercel Pro, SPF/DKIM/DMARC, Sentry DSN, prod migrations + `db:backfill-track-tz`
  on prod, Apple Developer / TestFlight, Firebase project + `google-services.json`.
