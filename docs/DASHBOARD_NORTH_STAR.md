# Dashboard North Star — the adaptive home

**Status:** Locked (founder interview, 2026-07-16). **Owner:** Jordan.

This doc governs what the dashboard (`/`) shows and in what order. `PRODUCT_NORTH_STAR.md`
ranks the pillars; `VISUAL_NORTH_STAR.md` owns how it looks. When a dashboard change is
proposed, check the boundary rule and the mode stacks here first.

---

## North star sentence

> **The dashboard shows *now and next* — today's story on a track day, what's coming up on
> an off day — one line per thing, verdicts not evidence. Depth lives in Analysis.**

## The boundary rule (dashboard vs Analysis)

**Now & next only.** The dashboard shows today plus the next action. One line per thing,
pre-computed verdicts, never raw evidence. Any tap for depth lands in Analysis / Sessions.
Analysis owns history, charts, comparisons, tables. If a dashboard block starts growing a
chart or a second screen of rows, it has crossed the line — move it.

Interview context (2026-07-16): the old dashboard was static ("tells me nothing new") and
mute ("no what-next guidance"). Of everything on it, only the Start-run CTA earned its
place. The "launchpad, not a report" framing is retired — the dashboard is a *briefing*.

---

## Two modes, auto-switched

| Mode | Trigger |
|---|---|
| **Track day** | A run or draft was logged today, **or** today falls inside an active event's dates. |
| **Off day** | Otherwise. |

Auto only — no manual toggle. (Revisit if the "reviewing at the track café" case ever hurts.)

## Track-day stack (a pit board)

1. **Start / Finish-run CTA** — unchanged, always #1.
2. **Today so far** — run-by-run strip, latest first: session label, best + avg lap,
   ▲/▼ vs the previous run today, what setup changed. The day's story in one glance.
   Stays distinct from Analysis because it is today-only, one line per run, no charts;
   tapping it lands in the Sessions debrief.
3. **Engineer's read** — the Engineer north star's post-run card (quick contract,
   tap → chat pre-anchored to the run). Appears **only when it has something to say**;
   carries an **"Early"** badge while the Engineer matures so imperfection is expected.
   "Trying this" lifecycle deferred to Engineer Phase 3.
4. **Things to try** — the driver's experiment list, live on the page during a session.

## Off-day stack (a prep surface)

1. **Start-run CTA.**
2. **Next event prep** — days out, track, what you ran there last time (best lap + when).
   Absorbs and replaces the old race-meeting card.
3. **Last session digest** — when/where, runs + best lap, what changed, how it felt,
   pace vs the previous visit to that track. Absorbs the previous-run card.
4. **Things to try / to do** lists.
5. **Last 30 days card** — demoted to the bottom, always last. Ambient momentum, never the lead.

**No upcoming event:** the digest steps up to lead, with a quiet "Add your next event" line.

## Retired (2026-07-16)

- **Launchpad doors** ("See the debrief" / "Ask the Engineer") — the dock + in-card taps route there.
- **Previous run card** — absorbed by Today-so-far (track day) and the digest (off day).
- **Race meeting card** — absorbed by Next-event-prep and the track-day header context.

## Engineer on the dashboard

The Engineer becomes a *visible pillar*, foundations first: the read card ships before the
Engineer is fully refined, flagged as early. Future (noted, unbuilt): free-tier teaser in
the read slot ("unlock the Engineer's read"); auto-read-per-run gated to a paying tier that
covers the AI cost. Generation stays on the existing suggestion pipeline
(`dashboardSuggestions/`), peek-cached, generated on demand or post-run.

## Success test

Open the app on a track day between runs: within 5 seconds you know how the day is going
and what to consider next run. Open it on a Tuesday: within 5 seconds you know what's
coming up and what last session taught you. If either glance says "nothing new," the
dashboard has failed its job.

**Changelog:** 2026-07-16 initial — 4-round founder interview (moment, gaps, keepers, mode
design, boundary rule, stacks, retirements, Engineer foundations).
