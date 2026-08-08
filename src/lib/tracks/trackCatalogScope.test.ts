/**
 * Run: `npm run test:track-catalog-scope`
 * (needs `--conditions=react-server` — the dominance helper is `server-only`)
 *
 * Guards the fix for "tracks in my list have many duplicates": the demo seed clones the
 * founder's tracks (same name, same location, same createdAt) into the shared demo account,
 * and the catalog is global — so every seeded track showed up twice.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEMO_USER_ID_FALLBACK } from "@/lib/demo/demoAccess";
import { isThrowawayEmail, throwawayEmailWhere } from "@/lib/account/throwawayAccounts";
import { communityTrackListWhere, trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { dominantTrackByNameWhere } from "@/lib/tracks/trackCatalogDominance";

const real = { id: "user-a", email: "a@example.com" };
const demo = { id: DEMO_USER_ID_FALLBACK, email: "demo@jrcdynamics.com" };
const throwaway = { id: "user-ob", email: "jordancaaruso+ob0805-7d13@gmail.com" };

/** The throwaway clause the scope nests under `AND`, for reuse in the assertions below. */
const excludesThrowaway = (viewerId: string) => ({
  OR: [{ userId: viewerId }, { user: { isNot: { email: throwawayEmailWhere() } } }],
});

test("real sessions exclude demo-owned tracks", () => {
  assert.deepEqual(trackCatalogScopeWhere(real), {
    userId: { not: DEMO_USER_ID_FALLBACK },
    AND: [excludesThrowaway(real.id)],
  });
});

test("real sessions exclude throwaway onboarding-test tracks", () => {
  const [clause] = trackCatalogScopeWhere(real).AND as [{ OR: unknown[] }];
  assert.deepEqual(clause.OR?.[1], { user: { isNot: { email: throwawayEmailWhere() } } });
});

test("a throwaway session still sees its own tracks (mid-walkthrough)", () => {
  const [clause] = trackCatalogScopeWhere(throwaway).AND as [{ OR: unknown[] }];
  assert.deepEqual(clause.OR?.[0], { userId: throwaway.id });
});

test("an anonymous viewer gets the exclusion with no own-rows escape hatch", () => {
  assert.deepEqual(trackCatalogScopeWhere({ email: null }).AND, [
    { user: { isNot: { email: throwawayEmailWhere() } } },
  ]);
});

test("only the +ob aliases count as throwaway", () => {
  assert.equal(isThrowawayEmail("jordancaaruso+ob0805-7d13@gmail.com"), true);
  assert.equal(isThrowawayEmail("JordanCaaruso+OB0805-7D13@Gmail.com"), true);
  // A real member whose address merely contains the tag, or sits on another domain.
  assert.equal(isThrowawayEmail("someone+ob@example.com"), false);
  assert.equal(isThrowawayEmail("jordancaaruso@gmail.com"), false);
  assert.equal(isThrowawayEmail(null), false);
});

test("demo session sees only demo-owned tracks", () => {
  assert.deepEqual(trackCatalogScopeWhere(demo), { userId: DEMO_USER_ID_FALLBACK });
});

test("scope applies with the env unset (seed writes the fixed id either way)", () => {
  const prev = process.env.DEMO_USER_ID;
  delete process.env.DEMO_USER_ID;
  try {
    assert.deepEqual(trackCatalogScopeWhere(real), {
      userId: { not: DEMO_USER_ID_FALLBACK },
      AND: [excludesThrowaway(real.id)],
    });
  } finally {
    if (prev === undefined) delete process.env.DEMO_USER_ID;
    else process.env.DEMO_USER_ID = prev;
  }
});

test("DEMO_USER_ID env overrides the fallback id", () => {
  const prev = process.env.DEMO_USER_ID;
  process.env.DEMO_USER_ID = "demo-other";
  try {
    assert.deepEqual(trackCatalogScopeWhere(real), {
      userId: { not: "demo-other" },
      AND: [excludesThrowaway(real.id)],
    });
    assert.deepEqual(trackCatalogScopeWhere({ id: "demo-other" }), { userId: "demo-other" });
  } finally {
    if (prev === undefined) delete process.env.DEMO_USER_ID;
    else process.env.DEMO_USER_ID = prev;
  }
});

test("search keeps the scope alongside the name/location OR", () => {
  const where = communityTrackListWhere(real, "boronia");
  assert.deepEqual(where.userId, { not: DEMO_USER_ID_FALLBACK });
  assert.equal(where.OR?.length, 2);
  // The search OR must not have displaced the throwaway exclusion — that is why it is nested.
  assert.deepEqual(where.AND, [excludesThrowaway(real.id)]);
});

test("empty search still scopes", () => {
  assert.deepEqual(communityTrackListWhere(real, "  "), {
    userId: { not: DEMO_USER_ID_FALLBACK },
    AND: [excludesThrowaway(real.id)],
  });
});

test("name-dominance lookup never resolves onto a demo clone", () => {
  const where = dominantTrackByNameWhere("Boronia", real);
  assert.deepEqual(where.userId, { not: DEMO_USER_ID_FALLBACK });
  assert.deepEqual(where.name, { equals: "Boronia", mode: "insensitive" });
});

test("blank name matches nothing", () => {
  assert.deepEqual(dominantTrackByNameWhere("   ", real), { id: { in: [] } });
});
