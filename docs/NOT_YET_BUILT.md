# Not yet built — spec'd features that don't exist in the app yet

**Purpose:** one place that records features which have been **designed / spec'd / prototyped but are
not implemented in the codebase**. If someone asks "how does X work" and X is in this table, the honest
answer is *"that's planned, not built"* — don't assume a spec means shipped code.

**Rule for agents:** before answering that a feature exists, or before "fixing" it, check here. A north-star
doc or an Artifact prototype is **intent**, not implementation. Move a row to its "shipped" note (or delete it)
only once the code actually lands and is verified. Keep this in sync with the rollout tables inside each linked spec.

_Last reviewed: 2026-08-14._

---

## Registry

| Feature | State | Spec / reference | Notes on what exists vs not |
|---|---|---|---|
| **Results & Trophies** | Spec + visual prototype only — **no code** | `docs/RESULTS_TROPHIES_NORTH_STAR.md`; prototype: https://claude.ai/code/artifact/346e8f24-a562-4e67-b01a-dcb7e1b798d0 | Nothing persisted today: no `EventResult` model, no `Event.level`, no `view_multi_main_result` parser, no trophy case / dashboard results strip. `EventParticipation` stores notes/spec-tire/pin only. LiveRC result *pages* are parsed for laps, not for finishing position. Phase 1 = parser + schema migration + class-confirm UI. |
| **Next outing plan** | Founder idea, outlined in chat 2026-07-19 — **no spec doc, no code** | Outline in agent memory (`next-outing-plan-idea`); grew out of the dashboard-v2 off-day "plan the next outing" card | Per-event plan built at home with the Engineer: starting-setup diff (from known-good), ordered test plan with predictions, and scenario branches (grip/heat/rain → first move). On-demand deep-mode generation only, tap-to-answer interview first, driver-editable. Nothing exists: no plan model, no event-page plan surface, no scenario picker. Pairs with Engineer Phase 3 lifecycle + weekend model (blueprint A). |
| **Debrief — Engineer half** | Box + live figures **built 2026-09-14** (`MeetingDebrief`, `src/lib/debrief/`, `DebriefCard` on the Sessions day). Engineer side ruled 2026-09-14, **not built, post-launch** | Founder interview 2026-09-14 (agent memory `debrief-built-2026-09-14`); `docs/USER_FEEDBACK_BACKLOG.md` FB-21 | Not built: the Engineer reading the debrief text (`driverData.ts` after `buildDayBlock`), a "Review my weekend" starter, and the on-tap AI recap (recap only, no advice, door to chat; Notebook limited / Pro automatic; counts as an Engineer ask) — the `aiSummary*` columns exist and are empty. Push "your Saturday is summarised" needs the cron scheduled and push users first. |
| **Monetisation — demo only** | Phases 1, 2, 4, 5 **built + test-mode driven** 2026-08-01; Phase 3 (demo) **deferred, not built** | `docs/MONETISATION_NORTH_STAR.md` | Shipped: paid door (`/join` → public checkout → webhook provisioning → magic link), enforcement (shell gate, Pro locks, Engineer caps+meter), landing (`/welcome`), comp-code path, grandfather retired. NOT built: the full-data demo — snapshot/anonymize script, public `/demo`, read-only guard, pre-baked Engineer threads, capped live asks. Live launch itself = founder runbook in the doc. |
| **Season history import ("bring in my history")** | Founder call 2026-09-18: **a future feature, deliberately not built.** Discussed, costed, no spec doc and no code | Agent memory `season-history-import-deferred`; builds on the shipped 14-day range import (`src/lib/sweep/getMyDayDays.ts`, `GET_MY_DAY_REACH_DAYS = 14`) | A new user with months of racing on LiveRC/Speedhive wants it all in at signup. **Do not widen the day calendar to do it**: the import is one foreground request per day (~4-5 s a quiet day, ~35-50 s a race day), so six months is ~30 min of a held-open sheet, and closing it stops the loop. Not built: a background/queued history job (paced so a club timing site is not hit 183 times in half an hour), per-meeting car assignment instead of one car for the whole stretch, an aggregation rebuild after the mass import, and a Starter-tier answer (15-run cap is blown instantly). Also unsolvable by import: historic conditions and setups - history gives lap times and trends only. |
| **Sector compare (driver vs driver)** | **Sector board BUILT 2026-08-28 evening (uncommitted)** — `driverCompare.ts` + `DriverComparePanel` on the Done step: the video first, then ONE table — you as the flat base (top-5 avg / best lap / same lap number), one driver as the coloured overlay, a Fastest chip per sector; tap a cell → that sector, tap a lap time → the whole lap, base as the ghost, Swap. Replaced the matrix + story cards after five artifact rounds. Driven-line overlay + delta line BUILT 2026-09-06 (`src/lib/videoAnalysis/trace/`). Still not built: track-map tab, half-speed, "scan another rival" (third drivers are partial, from the field matching). | `docs/SECTOR_COMPARE_NORTH_STAR.md`; `docs/VIDEO_AUTO_SECTORS_PLAN.md` changelog (sector board) | Rivals nobody tapped get times only where the scanned drivers' windows saw them — marked ⚑. |

### Related workstreams tracked in their own docs (not built either)

These already have rollout tables marking items ⬜ **not started** — listed here so they're not forgotten. The linked doc is the source of truth for status.

| Workstream | Not-yet-built pieces (⬜ per that doc) | Source of truth |
|---|---|---|
| **Engineer north star** | Phase 3 suggestion lifecycle (`EngineerSuggestion` model, "trying this" → outcome linkback), Phase 4 driver profile, Phase 5 mode auto-inference, Phase 7 understanding layer, Phase 8 staged reasoning + verify, Phase 9 weekend model | `docs/ENGINEER_NORTH_STAR.md` (rollout status table) |
| **Video analysis rework** | Phases A + B **built 2026-07-11** (session Video row + adapter + tools page + doors; `AnalyzeFlowClient` 5-step mobile flow with library↔asset linking, replacing the legacy manual UX). Still not built: crop UI in the new flow, real-footage validation pass, Phase C (camera profiles → track entity, retire orphans: `UnifiedVideoAnalysisClient`, `VideoOverlayClient` family, `VideoAnalysisHub`, `VideoLibraryClient`, redirect routes, param-gated `jobs/new`). | `docs/VIDEO_ANALYSIS_REWORK_NORTH_STAR.md` (phases table) |
| **Video data trace** | Phase 1 delta surface **shipped 2026-07-10** (`LapComparePanel` in session expanded view; verified on synthetic results — real-footage gate open). Still not built: dashboard//analysis entry doors, manual-mode adapter, Phase 2 metric survey + continuous position export, Phase 3 speed channels, Phase 4 Engineer integration. | `docs/VIDEO_TRACE_NORTH_STAR.md` (rollout table) |
| **Setup upload** | Phone-photo lane and later staged-rollout items | `docs/SETUP_UPLOAD_NORTH_STAR.md` |

---

## How to add a row

When a feature is discussed/spec'd but you're stopping before implementation, add a row: **name · state · link to the spec/prototype · one line on what concretely does *not* exist yet** (the model, route, parser, or screen that's missing). When it ships, verify it end-to-end, then remove the row or annotate it as shipped with the commit/date.
