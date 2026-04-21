# Engineer stats — Phase 2 & 3 (spec only)

Phase 1 (histograms, Cliff’s delta, `gripTrendSignal`, quartile-disjoint, modal `topValues`, etc.) is implemented in `setupSpreadForEngineer.ts` and surfaced via `richEngineerContext`.

This document defines **candidate scope** for later phases before implementation.

## Phase 2 — richer cohorts and breakdowns

- **Per-track slices:** community stats restricted to uploads tagged with a specific `trackId` (or track cluster), in addition to surface + grip.
- **Class / session filters:** optional bucket by `raceClass` or event class when sample counts allow (min-*n* gate per slice).
- **Time decay:** weight recent uploads more heavily for “what people run lately” vs all-time medians (configurable half-life).
- **Stability metrics:** variance or coefficient of variation per parameter within a bucket to flag “everyone agrees” vs “all over the map.”

## Phase 3 — exploration and export

- **Saved views:** let power users pin a filter set (template + surface + grip + track) for the Engineer context block.
- **Export:** CSV/JSON of aggregated percentiles for offline analysis (respect privacy: aggregates only, no raw uploads).
- **Alerts (stretch):** notify when community median for a parameter shifts meaningfully week-over-week for a template (ops-heavy; likely out of scope until usage justifies it).

## Implementation notes

- Any new slice keys require **rebuild** of materialized aggregations (`POST /api/setup-aggregations/rebuild` or the batch job) and updates to `CommunitySetupParameterAggregation` query paths.
- Prompt changes belong in `openaiEngineer.ts` / `engineerRichContext.ts` whenever new fields are added to `setupVsSpread` rows.
