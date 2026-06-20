# Product North Star — JRC Race Engineer

**Status:** Living document (June 2026). **Owner:** Jordan.

This is the **ultimate goal and prioritization compass** for the product — not visual specs (`VISUAL_NORTH_STAR.md`), not a task backlog (`USER_FEEDBACK_BACKLOG.md`), not agent KB rules (`AGENTS.md`).

When you are unsure what to improve first, start here. Pick the **highest-ranked pillar** that is still broken or incomplete for the **every-run core loop**, not the shiniest idea.

---

## One sentence

> **Replace the race notebook** — help every RC driver log every run with almost no effort, review what worked, and get trustworthy setup guidance so they learn faster lap by lap.

---

## Who this is for

| | |
|---|---|
| **Everyone** | Absolute beginner through world-class pro. The product must work for a first test day and for a Worlds prep weekend. |
| **Solo drivers** | Individual pattern recognition across runs they might miss — even elites benefit. |
| **Teams** | High strategic value, possibly **more** than solo: teammates learn from each other's working setups; collate data across many drivers to narrow direction at race meetings (e.g. TITC — hard to know what everyone is running and what's working). |
| **Not for** | See [Non-goals](#non-goals). |

---

## The core loop (every run)

Everything else serves this loop. If a feature does not strengthen a step, deprioritize it.

```
Arrive at track
  → Log a run (minimal taps; laps auto-link; setup + notes + ratings seamless)
  → Review the day (what changed, what worked, pace vs competitors)
  → Ask the Engineer (setup suggestions between runs; post-event reflection)
  → Apply one change, log again
  → Repeat — every run, every meeting
```

**Frequency:** Every run. This is the notebook replacement, not an occasional analytics tool.

**North-star feeling:** Data capture is automatic enough that logging feels effortless; between runs the driver always knows **what to do next** and **why** — without spreadsheets, PDFs, or group chat archaeology.

---

## North-star moments (ranked)

All matter; build in this emphasis order.

| # | Moment | What "great" looks like |
|---|--------|-------------------------|
| **1** | **Effortless logging** | Minimal button presses; lap times auto-link; notes and ratings feel like a notebook but interactive and comprehensive — data arrives without conscious effort. |
| **2** | **Engineer** | Ask any setup question; accurate, max-context answers — like a real engineer at your shoulder. |
| **3** | **Run + setup tied to laps** | Every session is a complete record: handling feel, setup snapshot, lap data, video — one coherent object. |
| **4** | **Compare runs** | Side-by-side with trustworthy numbers; setup compare works well (not the headline, must not suck). |
| **5** | **Community aggregation** | Seamlessly integrated signal — what directions are working at this track / in this class. |
| **6** | **Video analysis** | Extremely polished, intuitive, genuinely useful (6-month polish target). |

---

## Data moat (what users accumulate)

Losing the app should feel like **losing a notebook** — painful because the history is irreplaceable.

- Setup history and what changed over time
- Team shared knowledge across drivers and events
- Long-term pattern recognition (what worked, when, where)
- Engineer conversation context tied to runs
- Community-relative signal (pace vs field, aggregation trends)

Protect this data. Make export/continuity trustworthy. The moat is **accumulated context**, not any single feature.

---

## Strategic pillars (founder's stack rank)

| Rank | Pillar | Always optimize | Notes |
|------|--------|-----------------|-------|
| **1** | **Lap time ingestion / session capture** | **Always #1.** Every sprint, ask: is logging more seamless? | Auto-link laps, minimal taps, copy last run, draft recovery, setup attached. |
| **2** | **Engineer AI** | Quick feedback loop: ask → respond → review → improve logic/prompt/context | KB-grounded whenever possible; weekly gold-set eval + AI reviewer (`docs/ENGINEER_ITERATION.md`); in-app tester star ratings. |
| **3** | **Teams** | Mutual visibility + collation at race meetings | Strategic multiplier; post-pilot hardening per `TEAMS_POST_PILOT_HARDENING.md`. |
| **4** | **Community aggregations** | Seamless integration, not a separate product | Automatic influx from PetitRC would be amazing; universal aggregations for cross-car params (toe, camber, etc.). |
| **5** | **Setup compare** | Must work well; not huge headline | Trustworthy run vs run and setup vs setup. |
| **6** | **Video analysis** | Polish toward intuitive utility | 6-month target; links to laps. |
| **7** | **Garage & catalog** | Boring, fast, correct | Cars, tracks, events, tires; setup pipeline (upload → calibrate → reuse). Easy to add new car models and setup sheets. |
| **8** | **iOS shell** | Conditional | Decision within 6 months; if yes, TestFlight-ready in that window (`TESTFLIGHT.md`). |

**Community aggregations** and **teams** amplify memory and Engineer; they are not substitutes for effortless logging.

---

## Horizons

### 6 months (end 2026)

| Outcome | Success criteria |
|---------|------------------|
| **Polish & trust** | Very polished feel; trusted by test users; ready for wider allowlist / beta expansion. |
| **Engineer KB** | Very comprehensive; answers feel trustworthy and KB-grounded. |
| **Multi-car / multi-discipline** | Seamless to add new car models and setup sheets; users on many different cars; begin off-road / 8th scale. |
| **Video analysis** | Extremely polished, intuitive, genuinely useful. |
| **iOS** | Decide pro/con; if yes, TestFlight-ready within 6 months. |
| **Milestone** | Potential Awesomatix team run at Worlds (~5 months) — consider as validation event. |

**Rule:** Do not start platform bets (PWM logger, in-app comms, deep LiveRC automation) until lap ingestion and Engineer trust are solid for beta users.

### 12 months

| Outcome | Success criteria |
|---------|------------------|
| **Daily habit** | Driver logs every run at test days and race meetings; consistently reviews days in the app. |
| **Engineer in the loop** | Setup suggestions between runs; post-event reflection (what went wrong/right); questions about setup, pace vs competitors, changes over time, pattern recognition. |
| **Teams at events** | Teams rely on the app at big events; collation answers "what's working" across drivers. |
| **Community scale** | Growing cross-discipline data; aggregations materially inform setup direction. |

### 12–24 months

| Outcome | Success criteria |
|---------|------------------|
| **Indispensable** | Constant companion — racers feel lost without it. |
| **Community** | Vast community data; hundreds of users across disciplines. |
| **Engineer evolution** | Extremely useful suggestions; automatic pattern recognition across time for setup direction. |
| **Investigate** | Constant video tracking → speed traces / turn video into structured data. |
| **Investigate** | PWM logger for steering/brake/throttle — hypothesis: 95% of telemetry value from video + simple PWM logger. |
| **Maybe** | In-app direct communication between teammates. |

---

## Engineer philosophy

The Engineer is not a generic chatbot. It is a **trusted setup engineer** grounded in the driver's context.

| Principle | Implementation |
|-----------|----------------|
| **KB-grounded** | Prefer vehicle-dynamics KB + parameter catalog; quote authoritative prose when relevant (`AGENTS.md` gates KB edits). |
| **Max context** | User's runs, setup snapshots, community spread, compare deltas — the answer should know what the driver already tried. |
| **Trust & scope** | User should know when the Engineer is going outside KB scope; never bluff physics. |
| **One testable move** | Suggest a single change to try next, not a laundry list. |
| **Feedback loop** | ask → respond → founder/user review → improve prompt, retrieval, rich context, intent — **before** expanding KB. |

Improve `openaiEngineer.ts`, `engineerRichContext.ts`, and retrieval before proposing KB/catalog edits.

---

## Teams as multiplier

Teams are not a social feature bolt-on. They solve a real race-meeting pain: **what is everyone running and what's working?**

- Teammates learn from each other's working setups without re-explaining in group chat.
- Collate data across many drivers to narrow setup direction under time pressure.
- Mutual run visibility + optional share flags; harden per teams docs.

Prioritize team value at **events** (many drivers, one weekend, one direction to find).

---

## Monetization principles

Not pricing tables — principles for future tiers.

- **Eventual subscription** — product must feel worth the cost.
- **Tier axes:** AI usage (Engineer), video analysis depth, team access.
- **Maximize revenue per user without feeling expensive** — value density over nickel-and-diming.
- **Free tier must prove the loop** — logging and basic review; paid tiers unlock depth (Engineer volume, video, team seats).

Do not optimize monetization before the loop is habit-forming for beta users.

---

## Non-goals

*Inferred from founder context — edit if wrong.*

| Not the goal | Why |
|--------------|-----|
| **Race timing / live scoring replacement** | Lap ingestion integrates with timing; we don't replace LiveRC/Speedhive as the venue clock. |
| **Full MoTeC-grade telemetry platform** | PWM logger + video is a hypothesis for 95% of value — not a general ESC/data logger ecosystem. |
| **Social network for its own sake** | Teams and community serve setup learning, not feeds and likes. |
| **Generic AI chat** | No run/setup context = out of scope. |
| **Feature sprawl in setup calibration** | Before log-run is delightful. |
| **KB rewrites for "clarity"** | Without explicit driver-facing approval (`AGENTS.md`). |

---

## How to decide what to improve first

Stop at the first step that fails.

1. **Core loop blocked?** — Can I log a run, find it in sessions, and ask the Engineer on my phone? If no → fix first.
2. **Broken trust?** — Would I make a setup decision from what the app shows? Wrong times, bad compare, bluffing Engineer → before cosmetics.
3. **Daily path?** — Tier A (`/`, `/runs/new`, `/runs/history`, `/engineer`, `/login`) before B (garage, analysis) before C (calibrations, admin). See `VISUAL_NORTH_STAR.md`.
4. **Tie-breaker** — Higher [pillar rank](#strategic-pillars-founders-stack-rank); then `USER_FEEDBACK_BACKLOG.md` size.
5. **Visual vs behavior** — Look & feel → `VISUAL_NORTH_STAR.md`; product → this doc. No API changes in visual passes.

---

## How to use this doc + related docs

| Reader | Use |
|--------|-----|
| **Founder (weekly)** | Re-read pillars + horizons before prioritizing; update after race weekends. |
| **AI agents** | Read before product/behavior changes (`AGENTS.md` points here). |
| **Contributors** | Check [Non-goals](#non-goals) and pillar rank if unsure a feature fits. |

| Question | Read |
|----------|------|
| What should the product become? | **This file** |
| What should it look like? | `VISUAL_NORTH_STAR.md` |
| Who can access what? | `.cursor/skills/security-architect/` |
| Usage feedback | `USER_FEEDBACK_BACKLOG.md` |
| KB / DB agent rules | `AGENTS.md` |
| Engineer stats / KB expansion / teams / iOS | `engineer-stats-phase-2-3-spec.md`, `VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md`, `TEAMS_PILOT.md`, `TESTFLIGHT.md` |

Update when daily driver behavior changes, priorities shift after a race weekend, or an [open decision](#open-decisions) resolves.

**Changelog:** 2026-06-20 initial; 2026-06-20 founder interview rewrite (notebook framing, full audience, ranked moments, data moat, horizons, Engineer philosophy, teams, monetization, non-goals, open decisions).

| Decision | Timeline | Notes |
|----------|----------|-------|
| **iOS: yes or no?** | Within 6 months | If yes → TestFlight-ready in same window. |
| **PWM logger feasibility** | 12–24 mo investigate | Steering/brake/throttle; paired with video for telemetry value. |
| **In-app teammate comms** | 12–24 mo maybe | Teams work without it today; evaluate after collation proves value. |
| **PetitRC / external aggregation influx** | When aggregations pipeline is routine | High leverage if automatic. |

---

## Open decisions
