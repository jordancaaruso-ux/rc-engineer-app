# Dashboard North Star — the adaptive home

**Status:** Locked (founder interviews 2026-07-16 + v2 2026-07-19). **Owner:** Jordan.

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
Analysis owns history, charts, comparisons, tables — **and the run lists**: v2 removed the
dashboard's run-by-run strip because it duplicated the top of Analysis. If a dashboard
block starts growing a chart or a second screen of rows, it has crossed the line — move it.

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
2. **Day verdict card** (`DashboardDayVerdictCard`, "three instruments" — variant A of the
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
3. **Things to try** — the driver's experiment list, live on the page during a session.
4. **Last 30 days card** — always last.

## Off-day stack (plan the next outing)

1. **Start-run CTA.**
2. **Next outing card** (`DashboardNextOutingCard`, "countdown hero" — variant D of the
   artifact board): event day-count + date, one **"last visit"** line (best lap · runs ·
   when — this line *is* what remains of the old digest), open to-dos chip, and the
   **Test plan** — the Things-to-try list living inside the card, editable in place.
   Countdown block taps through to the event.
   **No event booked → plan-only degrade:** same card, no countdown; the Test plan leads
   and the footer becomes "Book your next track day" (→ /events). The card always exists.
3. **Things to do** — reminders list.
4. **Last 30 days card** — always last.

## Retired

**2026-07-16:** launchpad doors · previous-run card · race-meeting card.

**2026-07-19 (v2):**
- **Today-so-far run strip** — the run list belongs to Sessions/Analysis; the verdict card
  is its door. (`DashboardTodaySoFarCard` deleted.)
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
- 2026-07-19 **v2** — founder interview (3 rounds) + artifact variant board
  (https://claude.ai/code/artifact/c3d5964d-1448-48b0-87c9-c11d2b64a2d4): run strip → computed
  day-verdict card (variant A), Engineer auto-read retired → on-demand footer, off-day →
  next-outing countdown hero (variant D) with plan-only degrade, digest folded to one line.
  Built same day; verified via CDP at 390 px on real data (track-day via rc_tz window trick,
  off-day plan-only live).
- 2026-07-16 initial — 4-round founder interview (moment, gaps, keepers, mode design,
  boundary rule, stacks, retirements, Engineer foundations).
