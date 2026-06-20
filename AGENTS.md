# Agent working notes

Guidance for any AI agent working in this repository (Cursor, Claude Code, Codex, etc.). Read this before making edits.

For **product direction and prioritization** (core loop, pillar rank, horizons), read `docs/PRODUCT_NORTH_STAR.md`.

For **Engineer quality iteration** (eval failures, prompt/context/retrieval fixes, gold-set hygiene), use `.cursor/skills/engineer-improver/SKILL.md` — invoke only when the founder says "improve engineer" or similar. Session logs: `docs/ENGINEER_CHANGELOG.md`.

## UI / visual design (Technical v2)

**Before any UI, styling, layout, or visual rework** — read `docs/VISUAL_NORTH_STAR.md` and follow it. That doc is the locked north star: palette, typography, component vocabulary, journey-map rollout order, and per-screen checklist.

### Hard rule

- **Visual changes only** unless the user explicitly asks for behavior, routing, or API changes. Restyle; do not refactor flows while "fixing" the look.
- **Use existing primitives** (`SurfaceCard`, `CardPanel`, `panel.tsx` — `Eyebrow`, `StatStrip`, `StatTile`, `Button` / `ButtonLink`) instead of inventing parallel card/stat/label patterns.
- **Semantic tokens** from `globals.css` / Tailwind (`bg-background`, `text-primary`, `border-border`, `font-mono` for data) — no new raw legacy hex (`#c92a2a`, `#2563eb`) or cool greys off-palette.
- **Yellow = actions only**; green/red = data deltas. See the doc for full semantics.

### When in doubt

Match the nearest **Tier A** screen that is already done (login, dashboard) or the shared components listed in the doc. Update the rollout status table in `docs/VISUAL_NORTH_STAR.md` when a screen tier is completed.

## Engineer KB is hand-curated ground truth

The "Engineer" feature retrieves prose verbatim from `content/vehicle-dynamics/*.md` (see `src/lib/engineerPhase5/vehicleDynamicsKb.ts`) and quotes it back to end users as authoritative RC car setup advice. **Any language written in those files is presented to drivers as if it were expert knowledge**, regardless of who wrote it.

The structured parameter-effect catalog at `src/lib/engineerPhase5/parameterEffects/catalog.ts` is treated as an extension of this KB — every entry declares a direction + hedge flag + strength that the Engineer quotes back to drivers as ground truth. The same approval gate applies.

### Hard rule

Do NOT modify, rewrite, expand, or "clean up" any file under `content/vehicle-dynamics/` **or any entry in `src/lib/engineerPhase5/parameterEffects/catalog.ts`** unless the user's most recent message either:

- explicitly names the file, or
- explicitly asks for KB content edits.

"Improving clarity", "tightening grammar", or "adding a missing concept" are NOT sufficient justification. Propose the change in chat with a diff and wait for the user to type explicit approval before writing.

The surrounding files (`types.ts`, `intentFromMessage.ts`, `query.ts`) are normal code — modify them freely when iterating on intent detection or join logic. Only `catalog.ts` entries are locked.

### If a KB edit is approved

- Match the existing terse, bold-for-technical-terms prose style. Avoid evocative / metaphorical language ("breathe", "platforms", "dances", "comes alive", "settles") unless the user dictated the exact wording.
- Preserve `##` heading levels — `searchVehicleDynamicsKb` splits sections on them.
- Keep each file under ~90 lines; propose a new file for genuinely new concepts.

### If a catalog entry is approved

- Every `effects.<outcome>` direction, hedge flag, and strength MUST trace to KB prose at the cited `kbSource` + `kbSection` anchor — quote the supporting line in the proposal message.
- `kbSection` must match a real `## Heading` in the file (slugified, lowercase, spaces → `-`).
- Prefer `hedge: true` whenever the KB uses "sometimes", "not always predictable", "depending on balance", "test", or lists opposing outcomes for the same move.
- Never add an outcome to an entry that the KB doesn't explicitly discuss for that parameter — leave the outcome key absent instead of guessing.

### When in doubt, fix the prompt instead

If the user asks for "the Engineer to answer X better", the fix usually belongs in:

- `src/lib/engineerPhase5/openaiEngineer.ts` — system prompt.
- `src/lib/engineerPhase5/engineerRichContext.ts` — structured context the Engineer sees.
- `src/lib/engineerPhase5/vehicleDynamicsKb.ts` — retrieval / ranking.

Try those before proposing a KB edit.

For a **physics-first KB expansion checklist** (draft topics only—not retrieved KB), see `docs/VEHICLE_DYNAMICS_PHYSICS_KB_ROADMAP.md`.

## Commits

Commit trailers like `Made-with: Cursor` are welcome — they make it easy to audit which commits were agent-authored later.

## Production PostgreSQL (Prisma)

- **Never run `prisma db push`** (or `npm run db:push`) against **production** `DATABASE_URL`. That updates the schema without updating `_prisma_migrations` and causes Vercel `prisma migrate deploy` to fail in a loop (`already exists`, `P3009`, etc.). **Production schema changes = committed migrations + `migrate deploy` only.**
- **Prefer a separate Neon branch / database for local dev** so `.env.local` does not point at prod during experimentation.
- **Repair drift** (prod URL in `.env.local`): `npm run db:migrate:reconcile` — runs `scripts/reconcile-prisma-migrations.cjs`, which applies `prisma/manual-recovery/<migration_name>.sql` via `prisma db execute` when a matching file exists, then `migrate resolve --applied` and retries `migrate deploy` until clean.

## Auth

- **Magic link + optional Google OAuth** via Auth.js (`src/auth.ts`): allowlist in `AuthAllowedEmail` + env `AUTH_ALLOWED_EMAILS` (see `src/lib/authAllowlist.ts`). Google: `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, callback `{AUTH_URL}/api/auth/callback/google`. Admins: `AUTH_ADMIN_EMAILS`, `src/lib/authAdmin.ts`. Session bridge: `src/lib/currentUser.ts` (`requireCurrentUser`, `getAuthenticatedApiUser`).
- **Teams / teammates**: mutual team visibility via `src/lib/teamAccess.ts`; one-way `TeammateLink` + per-run `shareWithTeam` via `src/lib/teammateRunAccess.ts`.
- **Security reviews**: use project skill `.cursor/skills/security-architect/SKILL.md` (access tiers T0–T6, IDOR, scale). Update `ACCESS_TIERS.md` when auth rules change.
- **iOS shell**: Capacitor (`capacitor.config.ts`, `ios/`), checklist in `docs/TESTFLIGHT.md`.

## Other areas worth knowing

- **Setup comparison logic**: `src/lib/setupCompare/` (IQR gradient scaling, community aggregation lookups).
- **Community aggregations**: `src/lib/setupAggregations/` (rebuild script, numeric stats including Phase 1 value histograms / Cliff's delta support).
- **Grip trend scoring**: `src/lib/engineerPhase5/setupSpreadForEngineer.ts` (`computeGripTrendSignal`, Cliff's delta, quartile-disjoint, per-parameter minimum meaningful delta).
- **Calibration auto-detection**: `src/lib/setupCalibrations/autoPickCalibration.ts`.

When changes affect community aggregation stats, remember to rebuild via `POST /api/setup-aggregations/rebuild` — stored rows are materialized and don't update automatically.
