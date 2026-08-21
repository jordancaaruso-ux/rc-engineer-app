# Asset Access North Star — creation, editing & verification

**Status:** Draft for founder review — becomes **locked** once Jordan edits and approves. **Owner:** Jordan.

Single source of truth for **who can create, edit, delete, and verify every asset type**, and how asset identity feeds community aggregations. Derived from the 2026-07-13 access audit + founder interview. `PRODUCT_NORTH_STAR.md` ranks the pillars; `ACCESS_TIERS.md` records the enforced auth rules once built; **this doc says what the rules should be.**

---

## North star sentence

> **Anyone can create what they need to log a run, instantly — but only verified identities shape community data.** Open creation with a founder-verified flag: zero trackside friction, quarantined mistakes, a catalog whose verified subset is 100% correct.

---

## The model

Two asset scopes, one rule each:

| Scope | Examples | Rule |
|---|---|---|
| **Per-user** | Car, tire set, battery, setup document, setup snapshot | Owner-only create/edit/delete. No verification concept. Unchanged. |
| **Global catalog** | Track (+layouts), tire type, additive type, chassis type (`SetupSheetModel`), event, calibration | **Open create + verified flag** (exceptions below). Rows are live instantly but *unverified* until the founder approves. |

### Why this model (decided 2026-07-13)

- **Never block logging** (pillar #1): a driver at an unlisted track must be able to create it between runs. Admin-only create was rejected for anything on the logging path.
- **"100% correct" means the verified subset**, not the whole catalog — at open signup the whole catalog can never be 100% while strangers can write to it. Verification + AI pre-seeding gets curated-catalog cleanliness with open-catalog friction.
- **Aggregation trust is the point**: unverified identities are excluded from community aggregation buckets (see below), so pollution is quarantined by default.

### Verified-flag semantics

| Aspect | Rule |
|---|---|
| Schema | `verifiedAt DateTime?` (null = unverified) on TireType, AdditiveType, Track, SetupSheetCalibration. Chassis types keep `isAuthorized` (same meaning; migrate name only if cheap). |
| Who verifies | Admin (founder) only — via the review queue (Phase 2). |
| Visibility | Unverified rows are **fully visible and usable by everyone**, with a **subtle "unverified" badge** in lists and pickers. No functional handicap for drivers. |
| Community aggregations | **Unverified identities never form community buckets.** Community template rebuild must check chassis `isAuthorized` (today it doesn't); condition-signature inputs follow the same rule as they migrate. Per-user (own-car) aggregations are unaffected. |
| Calibrations (special) | Anyone may create a calibration to unblock their own uploads; **auto-pick offers it to *other* users only once verified.** A wrong calibration silently mis-parses every reuser's setups — it needs the flag more than any catalog row. |
| Engineer | May hedge on unverified identities if it ever cites them; never treats unverified community context as ground truth (moot while they're excluded from buckets). |

### Unified edit/delete rule (all global catalog rows)

> **Creator may edit and delete their row while it is unverified AND unused by others. Once verified, or once another user depends on it → admin-only.**

"Used by others" per type: track → another user's run/event on it; tire type → another user's tire set/run; additive type → another user's run/event spec; chassis type → another user's car; calibration → another user's parsed document; event → another participant.

This replaces today's per-type patchwork (tracks creator-forever, tire types admin-only-edit, additives undeletable-by-anyone, events undeletable-by-design). Chassis types already follow it.

---

## Per-type target state

| Asset | Create | Edit / delete | Verified flag | Notes |
|---|---|---|---|---|
| **Track + layouts** | Any user | Unified rule | ✅ | Grip moves off the track entirely (below), making track edits low-stakes. DB case-insensitive unique on name. |
| **Tire type** | Any user | Unified rule (creators gain edit-while-unverified; admins keep full) | ✅ | `modelCode` unique stays the identity. AI pre-seed first (TC). |
| **Additive type** | Any user | Unified rule — **fixes**: admin delete parity with tires; pass `isAdmin` to `AdditiveGaragePanel` | ✅ | AI pre-seed. |
| **Chassis type** | **Admin-only** — the one exception | Existing `isAuthorized` rule (= unified rule) | ✅ (`isAuthorized`) | Missing chassis never blocks logging (pending-car flow). Type implies schema + calibration work users can't finish. Highest-stakes aggregation key. **Pending car creation pings the founder** (push/email) so the request loop actually closes. AI pre-seed expands coverage. Founder may open create later by removing the gate — the flag machinery already fits. |
| **Event** | Any user | Unified rule + **creator may delete while sole participant** (new endpoint; merge remains for the rest) | ⬜ none | Scoped by participation, no aggregation feed — verification adds nothing. Harden dedupe: land the deferred `(trackId, resultsSourceUrl)` unique constraint; warn on same-track overlapping-dates creates without a results URL. |
| **Calibration** | Any user (own use) | Unified rule | ✅ | Auto-pick cross-user only when verified. Refile on the hub under **Global assets** (shared infrastructure, not "My assets"). |
| **Car / tire set / battery / setup doc** | Owner | Owner | — | Unchanged. Keep atomic `where: { id, userId }` updates; fix the guard-then-unscoped-update patterns in `cars/[carId]` + `setup-sheet-models/[id]` PATCH. |

---

## Grip is not a track property (decided 2026-07-13)

Grip changes day-to-day — club day low grip, sugared big-event track high grip. Storing `gripTags[]` on Track is a modeling error that made shared-track edits dangerous (creator edits silently reshaped condition-bucket signatures for everyone).

**Target:** grip captured **per-run**, with the track providing a "typical grip" default that prefills the run form. Condition buckets key on the run-level value. Track keeps only durable facts (name, location, surface, layouts). Community aggregations already take grip from each setup document's own traction tags, so this reworks the per-user `CAR_PARAMETER_CONDITION` signature only.

This is the largest, riskiest piece (run capture UX + bucket rebuild + migration of existing tag data as prefill defaults) → its own phase, last.

---

## Dedupe doctrine

Verification handles *wrongness*; dedupe handles *duplication*. Both are needed in every model.

1. **DB constraints where identity is nameable:** track name (case-insensitive unique), event `(trackId, resultsSourceUrl)` (deferred migration — land it), tire/additive `modelCode` (already unique). Run `scripts/dedupe-setup-sheet-models.ts` and `scripts/dedupe-events.ts` before adding constraints.
2. **Create-time steering:** keep 409-with-existing-row (tracks, tire types) and near-match suggestions; moderate prominence (aggressive warnings rejected in interview — subtle badge chosen).
3. **Admin merge** remains the escape hatch for what slips through (events already have it; extend deliberately, not speculatively).

---

## AI catalog pre-seeding (approved 2026-07-13)

Agents sweep manufacturer sites, retailers (RCMart, EuroRC, AMain), and PetitRC to enumerate **tire types (TC first), additive types, and chassis types** into candidate rows. **Nothing lands without founder review** — each sweep produces a review artifact where Jordan approves / edits / rejects every row; approved rows land as **verified**. Goal: verified coverage ~complete before wider beta, so user creation becomes the rare exception.

### Tracks ARE pre-seedable (reversed 2026-08-19)

This section used to end "Tracks are not pre-seedable (long tail of local clubs) — open creation
carries them." That was wrong about the supply. Two open sources cover the head of the distribution
almost completely, and they cover each other's blind spots:

- **LiveRC subdomain sweep** — 1,126 hosts, 1,075 active in the last 12 months. Each track's own
  home page publishes its name, street, town, state and country, and the subdomain *is* the durable
  timing link. Strong in the US (765), AU (57), CA (56), UK (34), NZ (31); nearly absent in the EU.
- **OpenStreetMap `sport=rc_car`** — 544 named tracks with traced coordinates, **448 of them in
  Europe** (Germany, Italy, France, Sweden, Netherlands, Austria). Exactly the gap LiveRC leaves,
  and the pins are better than any geocode. ODbL: **attribution is required**, not optional.

Activity is filtered on **recency, never event count**. Measured 2026-08-19: a "50+ events" floor
would have dropped 513 still-active tracks, 507 of which had raced within three months. Event count
measures whether a club posts its club nights to LiveRC — a habit, not a pulse.

**MYLAPS/Speedhive data is not used and must not be added.** Their Conditions of Use Art. 5.3
forbids copying their data for commercial purposes (Dutch law, Haarlem courts, Art. 10.2). A 994-row
RC location dump exists and was deliberately discarded. The risk that matters is not a lawsuit but
an IP block, which would break Speedhive lap import for paying EU users — a self-inflicted outage on
a shipped feature. The EU gap closes instead through **"find your timing link"** on any track with
no timing source: the first driver who races there pastes their own club's link once, and every
driver at that track gets lap import from then on. Setting timing URLs is already open to any
signed-in driver, so this needs no new permission.

Seeded rows are owned by a system account (`catalog@jrcdynamics.com` — deliberately not matching the
demo or `+ob…` throwaway patterns, or `trackCatalogScopeWhere()` would hide the whole catalog) and
land **verified**. `gripTags`/`layoutTags` are left empty: grip is logged per session, not declared
per track (see "Grip is not a track property" above). Idempotency comes from a unique
`(catalogSource, catalogSourceRef)`, so re-running the import updates rather than duplicates.

Pipeline, review tool and the rights reasoning: `seeds/track-catalog/README.md`.

---

## Admin review surface

**A `/admin/review` queue page + web-push nudge** (infra from `docs/PWA_NORTH_STAR.md`): all unverified assets across types, newest first — per row: approve / edit-then-approve / merge-into-existing / reject. Pending-car chassis requests appear in the same queue. Without the nudge an approval queue silently rots; at open signup that means a growing unverified backlog.

---

## Rollout phases (founder delegated ordering, 2026-07-13)

| Phase | Scope | Status |
|:--:|---|---|
| **1** | **Verified flag + unified authz** — schema flags + migrations; unified edit/delete rule across all catalogs; community rebuild excludes unverified; calibration auto-pick gating; unverified badge in lists/pickers; loose-end fixes (additive delete parity + `isAdmin` prop, atomic updates, DB dedupe constraints + dedupe scripts, hub relabeling: calibrations → Global assets, Cars/Tires label collision) | 🟡 Built 2026-07-13 (tsc + `next build` + unit tests green; migration written, NOT applied to prod). See "Phase 1 as-built" below. |
| **2** | **Review queue + pings** — `/admin/review` page; push/email on new unverified asset; pending-car chassis-request ping; event creator-delete endpoint + event dedupe constraint | ⬜ |
| **3** | **AI catalog pre-seed** — tire types (TC) → additive types → chassis types; review artifact per sweep; approved rows land verified. Can run parallel to 2. | ⬜ |
| **4** | **Grip → per-run remodel** — run-level grip capture, track prefill, condition-bucket rework, tag migration | ⬜ |

**Ordering rationale:** Phase 1 is the policy itself and everything it touches in one pass. Phase 2 makes it sustainable. Phase 3 makes verified coverage high before users arrive but depends on nothing. Phase 4 is independent, biggest, and riskiest — last.

---

## Phase 1 as-built (2026-07-13)

What shipped, and the scope calls made while building:

- **Schema:** `verifiedAt DateTime?` added to `TireType`, `AdditiveType`, `Track`, `SetupSheetCalibration`. Chassis keeps `isAuthorized`. Migration `prisma/migrations/20260713120000_add_catalog_verified_at/` is **written but NOT applied to prod** — deploy via the normal `migrate deploy` pipeline (never `db push`). `prisma generate` binary step hit a Windows EPERM (a concurrent dev server held the query-engine DLL); the client **types** regenerated fine, so tsc/build are valid — re-run `prisma generate` once the lock clears before shipping.
- **Unified authz:** `src/lib/assets/catalogAccessLogic.ts` (`canManageCatalogRow` = admin ∥ creator-while-unverified-and-unused; `mightManageCatalogRow` for optimistic UI) + `catalogUsage.ts` (`usedByOthers` queries). Applied to tire-type + additive-type PATCH/DELETE (was admin-only / undeletable) and track PATCH (tags path) + DELETE.
- **Track field split (refinement):** only grip/layout **tags** (the aggregation identity the founder flagged) fall under the lock. GPS + LiveRC/Speedhive **URL contributions** stay open to any authed driver, so the run-complete "mark location" loop keeps working. Documented in the route.
- **Aggregation exclusion:** community template rebuild now skips cars linked to an **unverified chassis model** (`isAuthorized === false`), with a new `excludedUnverifiedTemplate` counter surfaced in the aggregations debug page. Legacy-string cars (no model link) still count. Per-user own-car aggregations are untouched (they're the user's own data).
- **Calibration auto-pick gating:** new `calibrationsAutoPickableByUserWhere` = own ∪ verified; swapped into all three cross-user auto-pick paths (`buildCalibrationFingerprints`, `buildImageCalibrationCandidates`, quick-create model fallback). Listing/manual selection stays global. **At launch every `verifiedAt` is null, so cross-user auto-pick returns nothing until the founder verifies calibrations** — expected, but verify the common ones early or hit-rate drops.
- **Admin verify action (minimal review surface):** each catalog PATCH accepts an admin-only `verified: boolean` → sets/clears `verifiedAt`. UI: shared `UnverifiedBadge` + `CatalogVerifyControl`/`CatalogVerifyToggleButton`; badge shown to everyone on unverified rows, Verify/Unverify toggle to admins — on `/tires`, `/additives`, `/setup-calibrations`, and the track detail page. (Full `/admin/review` queue is Phase 2.)
- **Loose ends done:** `AdditiveGaragePanel` rewritten to use `isAdmin` and reach parity with tires (open create, badge, admin verify/edit/delete — fixes the "nobody can delete" + unused-prop gaps). Hub relabel: Global "Cars"→"Chassis types", Global "Tires"→"Tire catalog" (kills the My/Global collision), calibrations refiled under **Global assets**.

Deferred / deliberate deviations (carry into later phases):

- **DB unique constraints (track name, event `(trackId, resultsSourceUrl)`) NOT added yet** — adding a unique index before `scripts/dedupe-*` runs would fail the migration on existing duplicates. Do the dedupe pass + constraints together in **Phase 2**.
- **Calibration edit-lock kept as owner-or-admin** (not the full unified rule). The load-bearing protection is the auto-pick gate (a verified calibration is what got blessed); locking owner edits touches 6 call sites for an edge case. Revisit if owner edits to verified calibrations prove a problem.
- **Chassis-model edit logic unchanged** — it already is the reference pattern (`isAuthorized` = verified). Not migrated to the shared helper to avoid churn.
- **Picker badges (run-form tire/additive/track pickers) not added** — badge lives on the founder-facing list/detail surfaces where verification happens. "Fully usable" means no functional difference in pickers anyway.
- **Guard-then-update (`cars/[carId]`, `setup-sheet-models/[id]` PATCH) left as-is** — it's the repo's standard safe pattern and the audit rated it safe; not a real IDOR.

## Implementation map (code)

| Concern | Where it lives |
|---|---|
| Admin gate | `src/lib/authAdmin.ts` (env `AUTH_ADMIN_EMAILS`) |
| Chassis authz (the pattern to extend) | `src/lib/setupSheetModels/modelAccess.ts`, `src/app/api/setup-sheet-models/` |
| Track authz | `src/lib/tracks/trackAccessLogic.ts`, `src/app/api/tracks/` |
| Tire/additive types | `src/app/api/tire-types/`, `src/app/api/additive-types/` |
| Events | `src/app/api/events/`, `src/lib/events/eventAccessLogic.ts`, `mergeEvents.ts` |
| Calibrations | `src/lib/setupCalibrations/calibrationAccess.ts`, `autoPickCalibration.ts` |
| Aggregation rebuilds (verification checks go here) | `src/lib/setupAggregations/rebuildCommunityTemplateAggregations.ts`, `rebuildCarParameterAggregations.ts` |
| Hub sections | `src/lib/navConfig.ts` (`ASSETS_HUB_SECTIONS`), `AssetsHubClient.tsx` |
| Push infra | per `docs/PWA_NORTH_STAR.md` |

Update `ACCESS_TIERS.md` as each phase lands (rules become enforced, not aspirational).

---

## Changelog

- 2026-07-13 — Initial draft from access audit + founder interview: model A (open create + verified flag) adopted; chassis stays admin-only with request ping; unified edit/delete rule; unverified excluded from community aggregations; grip → per-run; AI pre-seed approved; subtle-badge UX; queue+push review surface; 4-phase rollout.
- 2026-07-13 — **Phase 1 built** (founder said "build"): schema flags + migration, unified authz helper + routes, community aggregation exclusion of unverified chassis, calibration auto-pick gating, admin verify action + unverified badges, additive-panel parity, hub relabel. tsc + `next build` + unit tests green; migration not applied to prod. See "Phase 1 as-built".
