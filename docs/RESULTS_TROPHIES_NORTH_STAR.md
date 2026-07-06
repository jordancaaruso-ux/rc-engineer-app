# Results & Trophies — North Star

**Status:** Draft (July 2026). **Owner:** Jordan. Interview-derived 2026-07-06.

Where **race results** live in the product: how we detect a driver's finishing position from
timing pages, turn A-main podiums/wins into **trophies**, tier them by event weight, and surface
them on a **shareable trophy-case profile** and a **dashboard results strip**.

Sits under `PRODUCT_NORTH_STAR.md` (this is a *pillar-3 Teams / data-moat* multiplier, not a
substitute for pillar-1 logging). Visual work follows `VISUAL_NORTH_STAR.md`. KB/DB/auth
guardrails in `AGENTS.md` still apply — this feature adds a schema migration, so **committed
migrations + `migrate deploy` only, never `db push` against prod**.

---

## One sentence

> When a driver races a timed event, we verify their finishing position and turn **A-main podiums
> and wins** into level-tiered trophies on a shareable profile — so results become part of the
> irreplaceable notebook, and teammates can see who's winning what.

---

## Why this fits the north star

- **Data moat** — accumulated, verified results history is irreplaceable; losing it = losing a trophy shelf.
- **Teams multiplier (pillar 3)** — "what is everyone running / how did everyone finish" at a meeting.
- **Motivation / retention** — trophies reward the logging habit that pillar 1 depends on.
- **Engineer fuel (pillar 2, later)** — finishing position vs pace-vs-field ("qualified P2, finished P6").

**Guardrail:** this must not out-prioritize effortless logging. Results are *detected from data the
driver already captures*, not a new manual chore.

---

## Locked decisions (2026-07-06 interview)

| Area | Decision |
|------|----------|
| **Result source** | Auto-detect from timing pages. **First source: LiveRC `view_multi_main_result`.** Parser is source-aware; other timing sites (Speedhive/MyLaps, RCScoringPro, etc.) come later. |
| **Trust model** | **Verified (auto) is the hero.** Optional manual entry allowed but **clearly flagged "self-reported"** and visually subordinate to verified. |
| **What earns a trophy** | **A-main only.** A-main P1 = **win** 🏆; A-main P2–P3 = **podium** 🥈🥉. B/C-main finishes are stored as *results*, never as podiums/wins. |
| **Identity match** | Reuse existing LiveRC driver name/ID resolution (`liveRcDriverIdResolve`, `liveRcNameNormalize`). User **confirms which class(es)** count as their result for that event. |
| **Event level** | `club / regional / state / national / worlds`, **tagged on the Event record** (shared across all participants of the global event). Level tiers the trophy visually. |
| **Achievement types** | Podiums & wins · **level-tiered honors** · **personal milestones** (first win, first podium, PB) · **streaks / consistency** (e.g. 3 podiums running). |
| **Surfaces** | **Shareable profile trophy case** (teammate-visible by default via existing team access; opt-in wider) + **dashboard results strip**. |
| **Beyond badges** | Results also feed **Engineer context** and **team-meeting collation** — later phases, not v1. |
| **Backfill** | Hard (many result-site formats). **Forward-only for v1.** On-demand backfill deferred until multiple parsers exist. |

---

## Reference: the source page

`https://tftr.liverc.com/results/?p=view_multi_main_result&id=993981`

- One page per class main. Example: **"ISTC 13.5T Triple A-Main Results"** — a triple-A-main
  format where legs **A1 / A2 / A3** aggregate to an **overall standing**.
- Table columns observed: **Position · Seeded · Driver · Points · per-leg (A1/A2/A3)**, with a
  tie-break note (IFMAR/ROAR). Driver names + positions live in table cells (same cheerio-parse
  family as `livercRaceResult.ts`).
- The **Position** column is the authoritative overall finish; per-leg columns are context.
- "Multi main" generalizes: a full event page can carry A / B / C mains — **only the A-main feeds
  podium/win trophies**; lower mains persist as results.

---

## Data model (new)

Nothing today stores "you finished P2" — `EventParticipation` holds notes / spec tire / pin only.
Add a first-class result concept; trophies/badges are **derived**, not stored redundantly.

- **`EventResult`** — per `user × event × class`:
  - `mainLevel` (A / B / C…), `position` (int), `entryCount` (field size),
  - `source` (`liverc_multi_main` | `manual` | …), `sourceUrl`, `verified` (bool),
  - resolved driver reference (LiveRC driver id / normalized name), `detectedAt`.
- **`Event.level`** — enum `club | regional | state | national | worlds` (nullable → "unknown").
- **`Event`** — optional result-source URL for the multi-main page, **distinct from the lap
  `resultsSourceUrl`** (they are different LiveRC page types).

Derived, not stored: podium/win status, level-tier of a trophy, milestones, streaks — all computed
from `EventResult` + `Event.level` so definitions can evolve without migrations.

> **Schema change = committed migration + `migrate deploy`.** Prefer a Neon dev branch locally.
> Do not `db push` against a prod-pointed `.env.local` (`AGENTS.md`).

---

## Phasing

### Phase 1 — Verified results pipeline *(prove trust first)*
- `view_multi_main_result` parser (source-aware; reuse cheerio + driver-name resolution).
- `EventResult` model + migration; `Event.level` field.
- Class-confirm UI: "we found you in these classes — which count?"
- **Done when:** we detect a real driver's A-main finish for a real event and persist it verified.

### Phase 2 — Trophy case + dashboard strip
- Derive podium / win / level-tiered badges from `EventResult`.
- **Shareable profile trophy case** — teammate-visible via `teamAccess` / `TeammateLink`; opt-in wider.
- **Dashboard results strip** — compact recent finishes (e.g. "P2 · TITC · 17.5 Stock").
- Visual: `SurfaceCard` / `panel.tsx` primitives; yellow = action only, level tier via typography/badge, not off-palette hex.

### Phase 3 — Manual (flagged) entry + milestones/streaks
- Manual result add for un-timed events, visibly **self-reported**.
- Milestone/streak definitions (first win, first podium, PB, N-podium streak, season top-5).

### Phase 4 — Engineer context + team collation
- Feed finishing position into Engineer rich context (ties to `competitionRelativeRanking.ts`).
- Team-meeting collation: who finished where across the team at an event.

---

## Open questions (decide before the relevant phase)

- **Profile detail vs privacy** — does the shared profile expose event/track/class specifics or just
  trophy counts? Needs a `security-architect` access-tier pass (T-tier for cross-user profile reads).
- **Self-report abuse** on any leaderboard surface — "self-reported" flag must never read as equal to verified.
- **Level default & who can set it** — creator sets on the global Event; conflict resolution if two participants disagree.
- **Milestone/streak exact rules** — Phase 3.
- **Second source** (Speedhive/MyLaps) — which unlocks meaningful backfill.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-06 | Initial draft from founder interview — locked source (LiveRC multi-main), A-main-only trophies, verified-hero + flagged-manual, event-record levels, shareable teammate profile + dashboard strip, forward-only v1, 4-phase plan. |
