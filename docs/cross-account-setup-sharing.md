# Cross-account PetitRC / setup visibility (design decision)

## Decision (default): Option B — discovery via stats, private files

- **Community aggregations** stay **template-scoped** (`setupSheetTemplate`), not per-user. Any authenticated user whose car uses the same template can see **community numeric stats** for that template + surface + grip bucket (existing behavior).
- **Setup documents** (`SetupDocument`) stay **per-user**. Other accounts do **not** see your PetitRC PDFs or uploaded setup files unless we add an explicit sharing feature later.

**Tradeoff:** Meets “same car → same community bucket” for Engineer and compare. Does **not** meet “browse other people’s PetitRC rows” without new product work.

## Option A (future): Template library (read-only, shared artifacts)

Use when product requires **cross-account file discovery** keyed by template.

**Sketch:**

1. **Schema**
   - Either extend `SetupDocument` with `visibility: private | template_library` and `librarySetupSheetTemplate: string | null`, **or** add `SharedSetupArtifact` with `setupSheetTemplate`, `contentHash`, `sourceUrl` / storage key, `createdByUserId`, `promotedAt`.
   - Dedupe by `(setupSheetTemplate, contentHash)` to avoid duplicate library rows.

2. **APIs**
   - `GET /api/setup/library?setupSheetTemplate=…` — list library rows visible to the current user (authenticated), only for templates that match one of their cars (or open read if you accept global browse).
   - `POST /api/setup/documents/:id/promote-to-library` — optional; gated by admin or user consent + dedupe.

3. **Privacy / review**
   - Require explicit opt-in (“promote my upload”), strip or hash identifying filenames if needed, and document that library rows are visible to other users with the same template.

**Recommendation:** Ship **Option B** until there is a concrete UX for library curation and support load.
