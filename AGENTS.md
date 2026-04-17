# Agent working notes

Guidance for any AI agent working in this repository (Cursor, Claude Code, Codex, etc.). Read this before making edits.

## Engineer KB is hand-curated ground truth

The "Engineer" feature retrieves prose verbatim from `content/vehicle-dynamics/*.md` (see `src/lib/engineerPhase5/vehicleDynamicsKb.ts`) and quotes it back to end users as authoritative RC car setup advice. **Any language written in those files is presented to drivers as if it were expert knowledge**, regardless of who wrote it.

### Hard rule

Do NOT modify, rewrite, expand, or "clean up" any file under `content/vehicle-dynamics/` unless the user's most recent message either:

- explicitly names the file, or
- explicitly asks for KB content edits.

"Improving clarity", "tightening grammar", or "adding a missing concept" are NOT sufficient justification. Propose the change in chat with a diff and wait for the user to type explicit approval before writing.

### If a KB edit is approved

- Match the existing terse, bold-for-technical-terms prose style. Avoid evocative / metaphorical language ("breathe", "platforms", "dances", "comes alive", "settles") unless the user dictated the exact wording.
- Preserve `##` heading levels — `searchVehicleDynamicsKb` splits sections on them.
- Keep each file under ~90 lines; propose a new file for genuinely new concepts.

### When in doubt, fix the prompt instead

If the user asks for "the Engineer to answer X better", the fix usually belongs in:

- `src/lib/engineerPhase5/openaiEngineer.ts` — system prompt.
- `src/lib/engineerPhase5/engineerRichContext.ts` — structured context the Engineer sees.
- `src/lib/engineerPhase5/vehicleDynamicsKb.ts` — retrieval / ranking.

Try those before proposing a KB edit.

## Commits

Commit trailers like `Made-with: Cursor` are welcome — they make it easy to audit which commits were agent-authored later.

## Other areas worth knowing

- **Setup comparison logic**: `src/lib/setupCompare/` (IQR gradient scaling, community aggregation lookups).
- **Community aggregations**: `src/lib/setupAggregations/` (rebuild script, numeric stats including Phase 1 value histograms / Cliff's delta support).
- **Grip trend scoring**: `src/lib/engineerPhase5/setupSpreadForEngineer.ts` (`computeGripTrendSignal`, Cliff's delta, quartile-disjoint, per-parameter minimum meaningful delta).
- **Calibration auto-detection**: `src/lib/setupCalibrations/autoPickCalibration.ts`.

When changes affect community aggregation stats, remember to rebuild via `POST /api/setup-aggregations/rebuild` — stored rows are materialized and don't update automatically.
