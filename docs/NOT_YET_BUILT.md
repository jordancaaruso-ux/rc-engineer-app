# Not yet built — spec'd features that don't exist in the app yet

**Purpose:** one place that records features which have been **designed / spec'd / prototyped but are
not implemented in the codebase**. If someone asks "how does X work" and X is in this table, the honest
answer is *"that's planned, not built"* — don't assume a spec means shipped code.

**Rule for agents:** before answering that a feature exists, or before "fixing" it, check here. A north-star
doc or an Artifact prototype is **intent**, not implementation. Move a row to its "shipped" note (or delete it)
only once the code actually lands and is verified. Keep this in sync with the rollout tables inside each linked spec.

_Last reviewed: 2026-07-08._

---

## Registry

| Feature | State | Spec / reference | Notes on what exists vs not |
|---|---|---|---|
| **Results & Trophies** | Spec + visual prototype only — **no code** | `docs/RESULTS_TROPHIES_NORTH_STAR.md`; prototype: https://claude.ai/code/artifact/346e8f24-a562-4e67-b01a-dcb7e1b798d0 | Nothing persisted today: no `EventResult` model, no `Event.level`, no `view_multi_main_result` parser, no trophy case / dashboard results strip. `EventParticipation` stores notes/spec-tire/pin only. LiveRC result *pages* are parsed for laps, not for finishing position. Phase 1 = parser + schema migration + class-confirm UI. |

### Related workstreams tracked in their own docs (not built either)

These already have rollout tables marking items ⬜ **not started** — listed here so they're not forgotten. The linked doc is the source of truth for status.

| Workstream | Not-yet-built pieces (⬜ per that doc) | Source of truth |
|---|---|---|
| **Engineer north star** | Phase 3 suggestion lifecycle (`EngineerSuggestion` model, "trying this" → outcome linkback), Phase 4 driver profile, Phase 5 mode auto-inference, Phase 7 understanding layer, Phase 8 staged reasoning + verify, Phase 9 weekend model | `docs/ENGINEER_NORTH_STAR.md` (rollout status table) |
| **Setup upload** | Phone-photo lane and later staged-rollout items | `docs/SETUP_UPLOAD_NORTH_STAR.md` |

---

## How to add a row

When a feature is discussed/spec'd but you're stopping before implementation, add a row: **name · state · link to the spec/prototype · one line on what concretely does *not* exist yet** (the model, route, parser, or screen that's missing). When it ships, verify it end-to-end, then remove the row or annotate it as shipped with the commit/date.
