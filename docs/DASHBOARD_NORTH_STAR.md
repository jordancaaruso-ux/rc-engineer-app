# Dashboard North Star — the adaptive home

**Status:** Locked (founder interviews 2026-07-16 + v2 2026-07-19; Setups card added and retired
2026-07-29; desktop pass 2026-08-07, **superseded by the "timing tower" redesign 2026-08-08**;
**phone stacks rebuilt 2026-08-20** — lists folded to the back, per-track trends promoted, one
cycling Engineer question, and the verdict card's Engineer footer removed).
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
- **At `xl`+ the page earns *today's own evidence*** — the runs you logged today and the read
  on your last one — plus, since 2026-08-08, **one pace series in the hero**. Nothing else the
  rule excludes: no comparisons, no tables, no other cars or metrics. Those stay in Analysis,
  and the tap-for-depth rule is untouched.

The test for a desktop-only block: *it is about today, your last run, or your pace trend; it
needs no data the dashboard model does not already carry; and removing it would not change
what the phone shows.*

The pace-series exception was argued and granted on 2026-08-08 — see the Desktop section. In
short: "am I getting faster" is the question the app exists to answer, a verdict line cannot
answer it, and the series costs no query. It is the only history on the page.

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
   - **Pace** — where the latest run sits against **the median of today's earlier runs**
     (avg-top-5 preferred, best-lap fallback; ±0.05 s reads as steady), which run was the
     best, and a per-run sparkline. Two runs draw the sparkline and print no verdict at
     all — see the anchor note below.
   - **Last change** — the most recent run that changed setup, and whether it helped
     (metric delta vs the run before it; inside the noise band = "effect unclear").
   - **Handling** (2026-08-15) — the driver's own 1–10 ratings across today, as a
     `RatingDial` plus the arc ("5 → 6 → 8 today"); direction is measured against the same
     anchor Pace uses. Past four runs the arc prints the day's low and high instead of the
     chain. **Replaced Consistency**, which was the spread of the
     latest run's five *fastest* laps: it scored a run with five clean laps and fifteen
     messy ones as "Tight", and it needed ≥5 imported laps to say anything, so it went
     blank on a club night with no timing import. A rating is required to mark a run
     complete, so the new row speaks whenever the day has one completed run.
     Consistency is untouched on **desktop** — the hero's second dial still reads
     `consistencyWord` / `consistencyPercent`, and the honest all-laps version (100 − CV)
     still lives in Analysis, which is what the Engineer reads.
   - **The anchor is the median of today's EARLIER runs, not run one** (founder call
     2026-08-25, `medianOfEarlier` in `dashboardVerdict.ts`). Run one anchored every row
     and is the worst anchor available: it is the worst run of the day by design, so
     "trending faster" by run four was close to automatic; it is a single run, so one
     session lost to traffic set the day's reference; and on pace it partly measures the
     track coming to everyone rather than the setup. A median uses every earlier run,
     survives one outlier, and still speaks on a three-run day. **A two-run day gets no
     direction on either row** — the only comparison available is the one this replaced.
   - **A day that wandered says so.** Handling has five states, not three: `flat` (every
     run rated the same — the ONLY day allowed to say "Same all day"), `swinging` (rose
     two points and fell two points, in either order → "Up and down"), `holding` (moved,
     but not past the 1.5-point band → "Settled"), plus improving/fading. The reported bug
     (2026-08-25) was a day that started and finished on the same rating and read "Same all
     day" on the bold line while the arc collapsed to `6 → … → 6` and hid the middle.
   - **No footer since 2026-08-20.** It read "✦ Ask the Engineer about today" and queued
     "give me your read on today so far" — a request to recite the figures printed directly
     above it. The Engineer moved to card 4 with better questions (founder call).
   - Tapping the card → Sessions with today expanded (the evidence).
4. **Ask the Engineer** (`DashboardAskEngineerCard`, 2026-08-20) — one written starter
   question, cycling. Takes the slot "How you're going" holds on an off day, because at the
   track the next change is the question and last month is not. See the section below.
5. **Ideas** — the driver's experiment list, live on the page during a session, and the one
   fold that **opens itself** on a track day.
6. **Things to do** — reminders, folded. New to the track-day stack on 2026-08-20; both lists
   now ride at the back of both stacks.

**No "How you're going" on a track day** (founder call 2026-08-20). One consequence, accepted:
the new-record celebration lives on that card, so a PB broken mid-meeting has no banner until
the drive home.

## Drafts on the dashboard — three days, then they stop asking (2026-08-25)

A draft run only exists because the driver tapped **Save draft** (the wizard's silent autosave is
a `localStorage` snapshot and never writes a `Run`), so every one of them was deliberate. Earlier
the same day that reasoning was taken a step too far and drafts were made to surface forever.
Driven on a real account it produced thirteen of them, most four and five months old, stacked
above the day's actual content with the yellow bar offering one. **Founder call: a draft holds
its place on the dashboard for three calendar days in the driver's zone — today and the two
before it — and then goes quiet.** Long enough to cover a race weekend; short enough that months
of leftovers stop owning the front page.

Two things this is deliberately not:

- **Not a delete.** Nothing is removed from the database for being old. An expired draft is still
  in run history with its amber "finish me" styling, still the driver's to finish or bin.
- **Not a drop on the day it is for.** A draft banked a fortnight ahead for a meeting that is
  running **today** still surfaces. That is the one case prepping ahead exists for.

**The CTA is the only draft surface on the dashboard.** A `DashboardDraftRunsCard` listing the
rest under the bar was built and cut the same afternoon — *"I don't want draft card to surface on
the dashboard, that's what the CTA 'finish' is for"*. Do not rebuild it. The consequence, accepted:
the bar only takes itself over for a draft that is **for today** (saved today, or its event is
running today), so a draft left from yesterday is not offered anywhere on the dashboard — it is
found in Sessions under the Drafts filter, which really does filter (`?status=draft`).

Where it lands: `src/lib/runs/resumableDraftLogic.ts` holds the rule (`DRAFT_DASHBOARD_DAYS`) and
`loadResumableDrafts.ts` the query; the dashboard model exposes one draft, not a list. The
"new run detected" notification path stays *tighter* than three days — `loadTodaysIncompleteRuns`
is today-only, because attaching fresh lap times to yesterday's draft is worse than an extra tap.

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
   when — this line *is* what remains of the old digest), and an "All events" footer.
   Countdown block taps through to the event.
   **No event booked:** the card degrades to the single "Book your next track day" row
   (→ /events). The card always exists.
   **Split 2026-08-18 (founder call).** It used to carry the Ideas list AND an "N to-dos
   open" chip as well, which made it a phone-screen-tall stack of two unrelated jobs. The
   chip is gone for good — it counted the Things-to-do list, which has its own card two
   rows down and printed the same number twice. The list moved out to card 4.
4. **How you're going** (`DashboardSummaryCard`) — the old Last-30-days card, promoted off the
   bottom on 2026-08-20 and opening on a new **Tracks** face: one little session trend per
   track visited in the window. See the section below.
5. **Ask the Engineer** — the same cycling question card as the track-day stack.
6. **Ideas card** — the try list, in its own `CardPanel`, on every kind of day, folded. Before
   the 2026-08-18 split it lived inside the outing card whenever a meeting was running and
   stood alone otherwise, so it moved on the driver depending on the data.
7. **Things to do** — reminders list, folded.

## The lists fold, and they ride last (2026-08-20)

Both lists collapse to one labelled row with their count (`DashboardListFold`), and both moved
to the **back** of both stacks. Measured before the change on a real account at 390px: the two
open lists filled roughly 500px of an 844px screen, so the phone dashboard was a to-do app with
a run button on top.

They are not the way into the lists and never were — the yellow edge tab (`IdeasEdgeTab`) opens
both from anywhere in the app. The dashboard copy is a convenience, so it sits where a
convenience sits.

**Ideas opens itself on a track day**, where the list is live and the driver is working through
it mid-session. Everything else starts closed. No persistence: a remembered fold has to be read
after hydration, so the card would jump open a beat after every paint for a state one tap
restores.

## How you're going — a trend per track (2026-08-20)

Face 1 of the card is one row per track visited in the window, most-active first: the track (and
class), the shape of its sessions oldest → newest, how many, and the best lap there. Three rows,
then a "+N more" line. The window's totals — runs, laps, wheel time — print as a line under the
title; the Overview face still carries them with their deltas, and Records is untouched.

It runs on `summary.paceByTrack`, which has been computed on every dashboard load and rendered
by nothing since 2026-07-10. **Per-track is the only honest scope** — one axis carrying a
12-second club track and an 18-second big track measures the drive to the venue, the same rule
that governs the desktop pace chart.

**It reports; it does not grade.** A per-track trend card was REMOVED on 2026-07-10 because a
trend drops on one slow session — a green track, traffic, a tyre gamble — and tells a driver
they are getting slower when they are not. Records replaced it for exactly that reason. So this
version keeps the shape and the figures and drops the verdict: only a faster window earns green,
a slower one prints in plain ink, and nothing on the card is red. Worth watching for a fortnight
after it ships — if it starts reading as a scoreboard again, that is the failure to catch.

`storageKey` moved with the new face (`dashboard-summary` → `dashboard-how-youre-going`).
PagedCard remembers the last face per device, so keeping the old key would have landed every
existing driver on Overview and hidden the new face behind a swipe they had no reason to make.

## Ask the Engineer — one question, cycling (2026-08-20)

`DashboardAskEngineerCard` shows one written starter question from
`selectDashboardStarterQuestions`, and turns to the next every 7 seconds. Tapping opens
`/engineer?prompt=…` with the full question in the composer — **it does not send**, which
matters more here than on the Engineer page: a mis-tap from the dashboard would otherwise spend
a request from the monthly cap on a question nobody asked.

- **The family filter is the whole rule.** A track day offers run / feel / plan questions; an
  off day trades feel for learn, because "loose on entry" is a question about a car that isn't
  in front of you. Eligibility (what needs a run in focus) is still the Engineer page's rule,
  reused — never re-implemented.
- **It cycles and the Engineer page's rail deliberately does not.** The rail is a tool you
  return to hunting for the chip you used last round, so it is fixed. This card is an
  invitation, and it rotates so it is not the same sentence at 9am and 4pm.
- **It stops for good on touch** (the same rule the phone rail uses for its auto-scroll), and
  reduced motion never rotates at all — a question that changes as you reach for it is a
  question you did not choose.

## One name for the try list: **Ideas** (2026-08-18)

The same list answered to three names — "Test plan" with an event booked, "Things to try"
without one, "Things to try" again in the side panel — so booking a race quietly renamed the
driver's own list. It is **Ideas** everywhere now: both dashboards, the Ideas & reminders
panel, the guided tour, and the add box ("Add an idea…"). "Things to do" is untouched; the
panel's title, **Ideas & reminders**, is where the pairing was already right.

The `data-tour` anchor ids (`test-plan`, `things-to-try`) deliberately kept their old
spelling — internal, pinned by `TOUR_ANCHOR_IDS`, and not worth the churn.

## Desktop (≥1280px) — "timing tower", 2026-08-08

The stacks above ARE the phone and are unchanged. At `xl` they are replaced wholesale by
`DashboardDesktop` — the design handoff's direction 1b. This supersedes the 2026-08-07
two-column pass, one day later; that pass's finding survives here (the lists are short text
rows and do not earn a wide measure, which is why they are the 420px column).

```
┌──────────────────────────────────────────────┬─────────────────────┐
│  HERO — best lap · dials · pace chart        │  START / FINISH RUN │
│  ── 6-up stat strip ─────────────────────────│  NEXT OUTING        │
├────────────────────┬─────────────────────────┼─────────────────────┤
│  LEDGER            │  IDEAS                  │  THINGS TO DO       │
└────────────────────┴─────────────────────────┴─────────────────────┘
   1.18fr                1fr                      1fr
   = 496px @1440         = 420px                  = 420px
```

Page cap 1760px (`.dash-wide`). Header is left-aligned with a mono timestamp beside the
title and no underrule — whitespace separates it, not a line.

### Two rows, and the race (2026-08-18)

The 2026-08-08 shape put three cards in the narrow column and two in the wide one, and the
lists are the only thing on this page that grows with use. Measured on a real account at
1440×900: left column **663px**, right column **885px** — 75px of Things-to-do below the
fold, its Engineer link never on screen without scrolling, beside **231px of empty page**
under the ledger. The document scrolled 85px to finish one narrow column.

So three columns with the hero spanning the first two. The ratio is chosen to land on
496 / 420 / 420 at 1440, which keeps the hero at exactly the 936px it already had and both
lists at exactly the 420px they already had — the move re-flows nothing. The ledger narrows
496px, which its label/figure rows read better at. All content now sits inside a 900px
viewport; the page's remaining ~64px of scroll is trailing padding, not content.

**The next outing now exists on desktop.** Before this, `xl` said `"Next out: <name>"` at the
foot of the run button and nothing else — no date, no countdown, no track, no last visit, no
way through to the event — and said *nothing at all* while a meeting was running, where the
phone reads "day 2 of 3". `desktop/DashboardNextOutingCard` sits under the run button with
the same three states and the same destinations as the phone card, drawn on the
`DashboardListCard` frame rather than the phone's hero surface. It costs no query:
`featuredEvent` was already built on every dashboard load and desktop read one field off it.

Two things fixed on the way past:

- **"Book your next track day" left the Ideas card footer.** It rendered on every load,
  including the ones where a track day was booked and named two cards above it. It is now
  the outing card's empty state — the only condition under which it is true.
- **The run button's footer dropped the event name.** The card below says it properly, with
  the date; the footer now speaks only about the run (draft in progress, or today's count).

**Desktop lists cap at 6 rows** (`DESKTOP_LIST_ROWS`) with a `+N more` line that expands in
place, so page height stops depending on how many ideas you happen to have. Phone is
uncapped — it stacks, so a long list costs a scroll rather than a broken layout.

**The hero is the point of the redesign.** Nothing on the old page answered the question
the app exists to answer, so the hero is built around one large lap numeral with a signed
delta chip, the rating dials beside it, and the pace trend to its right:

| Block | Track day | Off day |
|---|---|---|
| Numeral | best lap today | best lap · last run |
| Dials | handling · consistency (from the day's latest run) | same, from the last run |
| Chart | best lap per run today | best lap per session, last 8 |
| Strip | runs · laps · wheel time · active days · tracks · best streak (30d, both modes) |

**Two dials, not three.** The handoff specified a third — corner balance as a left/right
weight percentage ("51.4%, 1.4% L"). This app captures no corner weights of any kind, so
that dial had no data behind it. Founder call 2026-08-08: ship the two that are real. (What
the app *does* capture under "corner balance" is the entry/mid/exit understeer↔oversteer
axis on every run — a candidate for a future axis-mode dial, not a substitute for this one.)

**The rating ramp is the app's, not the handoff's.** The handoff groups 8 as "Dialled";
`CAR_RATING_BANDS` (founder-locked, regrouped 2026-08-03, flagged in-source as "not drift
to be fixed") puts 7–8 in "Good" and reserves "Dialled" for 9–10. `RatingDial` reads that
constant so it cannot disagree with the picker the driver actually taps.

### The pace chart and the boundary rule

The chart plots **history** — on an off day, the last eight sessions. That is the second
amendment to the boundary rule in two days, and it is deliberate (founder, 2026-08-08):

> The boundary rule stands for the phone. At `xl` the hero may carry **one pace series**,
> because "am I getting faster" is the question the dashboard exists to answer and a
> verdict line cannot answer it. One series, in the hero, nowhere else. Everything else
> the rule excludes — comparisons, tables, other cars, other metrics — stays in Analysis.

**It still costs no query.** The handoff assumed the off-day series needed a new one; it
does not. `completedRunRows` is the full run history the 30-day summary and the records
board already read, carrying best lap, laps and track per run. `heroPace` is derived from
it and from `todayStrip` in `dashboardServer.ts`. The only schema-adjacent change was
adding `carRating` to a select that already ran.

**Faster laps plot LOWER**, so an improving series slopes down. That matches the sparkline
on the verdict card; a lap chart that rose as times fell would read as a different quantity
on the same screen.

### Structure

A **twin render** at `xl` (`DashboardDesktop`), reversing the 2026-08-07 pass's single-DOM
approach. The two layouts are no longer the same cards in different places — the hero has
no phone equivalent and the phone's verdict / next-outing cards have no desktop slot — so
one DOM would render both compositions anyway. Consequences, handled:

- `PendingTeamInvitesCard` is hoisted out of both trees and rendered once, or it would
  fetch `/api/teams/invites` twice on every desktop load.
- The two `ActionItemListPanel`s mount twice. Only one is visible, both seed from the same
  server rows, and they can diverge only if the window is resized across 1280px mid-edit.
- `getCachedDashboardHomeModel` was bumped to **v3**. Bump it whenever the model gains a
  field: a cached v2 entry has no `heroPace`, so the hero renders nothing until the 30s
  window rolls — on a deploy that is every warm user seeing a broken page for half a minute.

### App shell — the icon rail

The 256px sidebar became a **76px icon rail** (`.sidebar` in globals.css, `sidebar.tsx`).
This is app-wide, not a dashboard change. Icon at 20px over a 9px label; active is
`rgb(255 255 255 / .05)` behind accent yellow; Settings sits at the foot via `margin-top:
auto`; the mark is the **yellow** JRC glyph because at 18px the white one reads as a smudge.

**All nine destinations are kept.** The handoff cut *Add run* and *Teams* to reach seven;
the cut was the designer's judgement, not a space constraint — nine 56px items plus the
mark fit inside 1080px with room to spare, and dropping the app's second-most-used verb
from the only persistent nav is not a trade worth making (founder, 2026-08-08). The 9px
labels are supporting only; every link keeps its `aria-label`.

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
- 2026-08-18 **desktop re-cut into two rows + the next outing card** — measured, not argued:
  663 vs 885px columns, 75px below the fold beside 231px of nothing. Grid goes to three
  columns with the hero spanning two; ledger, Ideas and Things-to-do share the bottom row.
  New `desktop/DashboardNextOutingCard` (three states, no new query, no cache bump — the
  fields were already in the model). Ideas footer's permanent "book your next track day"
  and the run button's "Next out: …" both retired. Desktop lists cap at 6 rows. Phone
  untouched.
- 2026-08-08 **"timing tower" redesign** — built from the `design_handoff_desktop_dashboard`
  bundle. Desktop replaced wholesale at `xl` by a hero (big lap numeral · RatingDials · pace
  chart · 6-up strip) over a ledger, beside a 420px column; 256px sidebar → 76px icon rail
  app-wide; new shared `RatingDial`; page cap 1760px. Boundary rule amended a second time to
  admit one pace series in the hero. Founder calls: keep all nine rail destinations (the
  handoff cut two), two dials not three (the third had no data in this app), and the app's
  own `CAR_RATING_BANDS` over the handoff's ramp. Phone unchanged and probe-verified at 390px.
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
