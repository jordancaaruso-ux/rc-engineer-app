# Dashboard North Star — the adaptive home

**Status:** Locked (founder interviews 2026-07-16 + v2 2026-07-19; Setups card added and retired
2026-07-29; **desktop pass 2026-08-07**).
**Owner:** Jordan.

This doc governs what the dashboard (`/`) shows and in what order. `PRODUCT_NORTH_STAR.md`
ranks the pillars; `VISUAL_NORTH_STAR.md` owns how it looks. When a dashboard change is
proposed, check the boundary rule and the mode stacks here first.

---

## North star sentence

> **The dashboard shows *now and next* — a computed verdict on today when you're at the
> track, the plan for your next outing when you're not — one line per thing, verdicts not
> evidence. Depth lives in Analysis.**

## The boundary rule (dashboard vs Analysis)

**Now & next only.** The dashboard shows today plus the next action. One line per thing,
pre-computed verdicts, never raw evidence. Any tap for depth lands in Analysis / Sessions.
Analysis owns history, charts, comparisons, tables. If a dashboard block starts growing a
chart or a second screen of rows, it has crossed the line — move it.

**The boundary is about attention, not about content** (founder, 2026-08-07). It was written
against a 390px screen where there is room for one thing at a time, and the cost of a second
block is that it pushes the first one off. A 1280px+ pane does not have that cost. So the rule
is **width-aware**:

- **Below `xl` the rule is unchanged and absolute.** The phone dashboard is now & next. Nothing
  in the desktop pass may add, remove or reorder anything at 390px — proven with
  `npm run layout:probe --width=390` before and after, not asserted.
- **At `xl`+ the second column earns *today's own evidence*** — the runs you logged today and
  the read on your last one. Still one line per row, still pre-computed. It does **not** earn
  history, charts, comparisons, other days, or anything requiring a new query. Those stay in
  Analysis, and the tap-for-depth rule is untouched.

The test for a desktop-only block: *it is about today or your last run, it needs no data the
dashboard model does not already carry, and removing it would not change what the phone shows.*

**No exceptions.** Every card here is derived from today or self-deletes when its job is done.
The permanent Setups card added on 2026-07-29 was the one attempt at an exception and it lasted a
week — see Retired.

Interview context (2026-07-16): the old dashboard was static ("tells me nothing new") and
mute ("no what-next guidance"). Of everything on it, only the Start-run CTA earned its
place. v2 context (2026-07-19): Today-so-far "stepped on Analysis's toes" and the auto
Engineer read produced bad answers — replaced by a computed verdict + on-demand Engineer.

---

## Two modes, auto-switched

| Mode | Trigger |
|---|---|
| **Track day** | A run or draft was logged today, **or** today falls inside an active event's dates. |
| **Off day** | Otherwise. |

Auto only — no manual toggle. (Revisit if the "reviewing at the track café" case ever hurts.)

## Track-day stack (an instrument, not a table)

1. **Start / Finish-run CTA** — unchanged, always #1.
2. **"Add a setup sheet" card** (`DashboardAddSetupCard`) — the onboarding ask only, gone for
   good once a setup exists. Most accounts never see it. See the section below.
3. **Day verdict card** (`DashboardDayVerdictCard`, "three instruments" — variant A of the
   2026-07-19 artifact board). **Computed only, no AI** (`src/lib/dashboardVerdict.ts`):
   - **Pace** — day trend across today's runs (avg-top-5 preferred, best-lap fallback;
     ±0.05 s reads as steady), which run was the best, and a per-run sparkline.
   - **Last change** — the most recent run that changed setup, and whether it helped
     (metric delta vs the run before it; inside the noise band = "effect unclear").
   - **Consistency** — spread of the latest run's five best laps, judged relative to lap
     length (≤1 % tight · ≤2.5 % fair · beyond scrappy).
   - Footer: **"✦ Ask the Engineer about today"** → chat in **quick mode** with a queued
     read-my-day prompt. This is the only Engineer entry on the card — always on demand.
   - Tapping the card anywhere else → Sessions with today expanded (the evidence).
4. **Things to try** — the driver's experiment list, live on the page during a session.
5. **Last 30 days card** — always last.

## The "add a setup sheet" card (both modes, position 2)

The onboarding ask, and only the ask (`DashboardAddSetupCard`; rules in `ONBOARDING_NORTH_STAR.md`).

- Shows once they have a car and **nothing that counts as a setup** — a named library setup or one
  read from an uploaded sheet. Per-run snapshots don't count; every run writes one, and that would
  silence the ask after run 1 for someone who never entered a value.
- **No Ignore button.** It retires itself the moment a setup exists, and never comes back.
- Suppressed while the Get-set-up card is up — that card owns the ask while it lives.
- Read **outside** the cached dashboard model: `getCachedDashboardHomeModel` has a 30s revalidate
  that setup writes don't bust, so the card would linger after they just added one.
  (`src/lib/setup/getDashboardSetups.ts`.)

## Off-day stack (plan the next outing)

1. **Start-run CTA.**
2. **"Add a setup sheet" card** — same card, same position, same retirement.
3. **Next outing card** (`DashboardNextOutingCard`, "countdown hero" — variant D of the
   artifact board): event day-count + date, one **"last visit"** line (best lap · runs ·
   when — this line *is* what remains of the old digest), open to-dos chip, and the
   **Test plan** — the Things-to-try list living inside the card, editable in place.
   Countdown block taps through to the event.
   **No event booked → plan-only degrade:** same card, no countdown; the Test plan leads
   and the footer becomes "Book your next track day" (→ /events). The card always exists.
4. **Things to do** — reminders list.
5. **Last 30 days card** — always last.

## Desktop (≥1280px) — added 2026-08-07

The stacks above ARE the phone, unchanged. At `xl` the same cards re-flow into a full-width
action strip over two asymmetric columns, plus two desktop-only cards that exist only there.
One DOM, `xl:`-prefixed placement only — never a separate desktop render (the cards are
stateful clients; a twin render would double-mount the invite fetch and the Things lists).

```
┌─────────────────────────────────────────────────────────────┐
│  START / FINISH RUN                             full width  │
├──────────────────────────────────┬──────────────────────────┤
│  .dash-main   minmax(0,1fr)      │  .dash-side  22rem→24rem │
│  the evidence — measured values  │  the lists — short rows  │
└──────────────────────────────────┴──────────────────────────┘
```

| Slot | Track day | Off day |
|---|---|---|
| Full width | Welcome · Get-set-up · Pending invites · **Start/Finish CTA** · Add-a-setup | same |
| `.dash-main` (wide, left) | Day verdict · **Today's runs** … then **Last-run read** · Last 30 days | **Last-run read** · Last 30 days |
| `.dash-side` (narrow, right) | Things to try *(or the active-event outing card)* | Next outing · Things to do |

- **The evidence gets the width; the lists do not** (founder, 2026-08-07). "Things to do" and the
  test plan are short text rows — they read fine at 22rem and looked padded at 47rem. The stat
  strips, the run strip's lap columns and the setup diffs are what a wide measure is for.
- **The CTA stays #1 and gets wider, not smaller.** A laptop can be at the track (founder,
  2026-08-07) — desktop must not assume "at home, reviewing". It sits outside the two columns
  and runs the full width, a bigger target than the phone card, and stops eating a card's height.
- **The 30-day summary is still last** — foot of the evidence column at `xl`, last card on the
  phone. Ambient momentum never leads.
- **`max-width: 90rem` cap.** Uncapped on a 1920px monitor a card renders ~1250px wide and
  the measure becomes unreadable. Capped and centred it reads as measure, not dead margin.
- **DOM order is phone order, not visual order.** The locked stack leads with the verdict and
  ends with the 30-day card, so on a track day the left column is *interleaved* around the right
  one and ships as two `.dash-main` boxes that the grid reunites in column 1. Do not merge them
  — that reorders the phone. `grid-auto-flow: dense` is what lets the second box back-fill
  beside the list rather than dropping to a new row.
- **Track day uses `grid-template-rows: auto 1fr`** (`.dash-cols-split`). A spanning item
  distributes its height across the intrinsic rows it crosses, so with two `auto` rows a long
  things-to-try list inflated row 1 and opened a hole between the two left boxes — measured at
  34px with a 400px list. A flexible second row sends that slack to the bottom of the column,
  where it is just column height. Off-day has one `.dash-main` and so needs neither.
- **`xl` (1280px), not `lg` (1024px) — measured, not assumed.** The pane is `100vw − 16rem` of
  sidebar, so a 1024px viewport leaves only ~704px to split, and the grid resolved to a **336px
  main column beside a 352px rail** — a "main" column narrower than its own rail *and* narrower
  than the 350px card the phone shows. Two columns need ~1280px of viewport to be worth having.
  Between 1024 and 1279 the dashboard stays the centred single column from desktop step 1.
  Resolved widths: 1280 → 592+352 · 1440 → 752+352 · 1920 → 944+384.
- **Both desktop-only cards are `hidden xl:block`** and return `null` when their model field is
  empty, so they cannot leave an empty shell on a new account.

### The two desktop-only cards

**Today's runs** (`DashboardTodayRunsCard`) — one row per run today, latest first: clock time,
run label, best lap, the best-lap delta vs the previous run, and what setup changed going in.
Straight from `todayStrip`, which the model has always built. Rows tap through to the run.

**Last-run read** (`DashboardLastRunReadCard`) — the car rating out of 10, the structured
handling read, and the setup diff you made going into it. Straight from `recentRun`. This is
the closest thing on the dashboard to "what should I change next" until that card is built —
it shows what you changed and how it felt, and leaves the conclusion to the driver.
Laid out FOR the wide column: a `StatStrip` across the full measure (the same primitive the
30-day card below it uses, so the column reads as one instrument) over a two-up body of
"You changed" and "How it felt". On a track day the newest run is usually this same run and
its diff is already on the verdict card *and* the run strip, so the card drops its own copy
rather than printing the same change three times on one screen.

Neither costs a query: both fields are computed on every dashboard load and were previously
discarded (`DashboardHome` destructured 12 of the model's 20 fields).

## Retired

**2026-07-29:** the **permanent Setups card** — one row per car naming the setup it was running,
shipped and removed the same week. It existed because the Garage wasn't where anyone looked for
the setup they were on; the reworked Garage fixed that at the source, leaving the card duplicating
a surface one tap away. Its onboarding empty state survives as `DashboardAddSetupCard` (above).
(`DashboardSetupsCard` + `src/lib/setup/dashboardSetups.ts` deleted; the per-car "what's it
running" read — last-run snapshot, newest-baseline fallback — went with them.)

**2026-07-16:** launchpad doors · previous-run card · race-meeting card.

**2026-07-19 (v2):**
- **Today-so-far run strip** — the run list belongs to Sessions/Analysis; the verdict card
  is its door. (`DashboardTodaySoFarCard` deleted.)
  **Partially reversed 2026-08-07:** it returns at `xl`+ only, as `DashboardTodayRunsCard`.
  The retirement stands on the phone and the reasoning still holds there — at 390px the strip
  duplicated the top of Analysis and cost the verdict card its place. In a 1184px pane it costs
  nothing, and the model never stopped building `todayStrip`. The phone dashboard is unchanged.
- **Last-session digest card** — survives as the single "last visit" line in the next-outing
  card. (`DashboardLastSessionDigestCard` deleted, `lastSessionDigest` model field removed.)
- **Next-event-prep card** — absorbed by the next-outing card. (`DashboardNextEventPrepCard` deleted.)
- **Auto Engineer read** — the v1 read card shipped 2026-07-17 and produced bad answers
  (generic, wrong, stale, waffly — all four failure modes). The Engineer on the dashboard is
  now **on-demand only** via the verdict-card footer. (`DashboardEngineerSuggestionsSection`,
  `EngineerSuggestionsCard`, `EngineerSuggestionsStrip`, and the `SHOW_DASHBOARD_ENGINEER_SUGGESTIONS`
  flag deleted; the `dashboardSuggestions/` lib + API route remain dormant.)

## Engineer on the dashboard

**On-demand, never pushed.** One quiet action on the verdict card opens chat in quick mode
anchored to today — full-strength model, per the Engineer north star's no-cheap-models rule.
A bad answer is one you asked for, not one the app pushed. Auto-generated reads return only
if/when trackside answers pass the founder's quality bar (see `ENGINEER_NORTH_STAR.md`
iteration engine). The future "next outing plan" idea (starting setup + scenario branches,
Engineer-drafted at home) extends the off-day card — see `NOT_YET_BUILT.md`.

## Success test

Open the app on a track day between runs: within 5 seconds you know how the day is going
and what to consider next run. Open it on a Tuesday: within 5 seconds you know what's
coming up and what you planned to test. If either glance says "nothing new," the dashboard
has failed its job.

**Changelog:**
- 2026-08-07 **desktop pass** — founder interview. Boundary rule made width-aware (attention,
  not content); `xl`+ gains a two-column shape under a full-width CTA strip; the Today-so-far
  strip un-retired at `xl`+ and a Last-run read card added, both from model fields that were
  already computed and discarded. Phone unchanged and probe-verified at 390px. Founder calls
  recorded: same auto-switch (no manual toggle), CTA stays #1 because a laptop can be at the
  track, 30-day summary demoted to the rail, and the "what should I change next" advice card
  **deferred, not declined** — `buildEngineeringReadV1` is the pure no-LLM door when it is wanted.
- 2026-07-19 **v2** — founder interview (3 rounds) + artifact variant board
  (https://claude.ai/code/artifact/c3d5964d-1448-48b0-87c9-c11d2b64a2d4): run strip → computed
  day-verdict card (variant A), Engineer auto-read retired → on-demand footer, off-day →
  next-outing countdown hero (variant D) with plan-only degrade, digest folded to one line.
  Built same day; verified via CDP at 390 px on real data (track-day via rc_tz window trick,
  off-day plan-only live).
- 2026-07-16 initial — 4-round founder interview (moment, gaps, keepers, mode design,
  boundary rule, stacks, retirements, Engineer foundations).
