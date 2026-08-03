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
import { communityTrackListWhere, trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { dominantTrackByNameWhere } from "@/lib/tracks/trackCatalogDominance";

const real = { id: "user-a", email: "a@example.com" };
const demo = { id: DEMO_USER_ID_FALLBACK, email: "demo@jrcdynamics.com" };

test("real sessions exclude demo-owned tracks", () => {
  assert.deepEqual(trackCatalogScopeWhere(real), { userId: { not: DEMO_USER_ID_FALLBACK } });
});

test("demo session sees only demo-owned tracks", () => {
  assert.deepEqual(trackCatalogScopeWhere(demo), { userId: DEMO_USER_ID_FALLBACK });
});

test("scope applies with the env unset (seed writes the fixed id either way)", () => {
  const prev = process.env.DEMO_USER_ID;
  delete process.env.DEMO_USER_ID;
  try {
    assert.deepEqual(trackCatalogScopeWhere(real), { userId: { not: DEMO_USER_ID_FALLBACK } });
  } finally {
    if (prev === undefined) delete process.env.DEMO_USER_ID;
    else process.env.DEMO_USER_ID = prev;
  }
});

test("DEMO_USER_ID env overrides the fallback id", () => {
  const prev = process.env.DEMO_USER_ID;
  process.env.DEMO_USER_ID = "demo-other";
  try {
    assert.deepEqual(trackCatalogScopeWhere(real), { userId: { not: "demo-other" } });
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
});

test("empty search still scopes", () => {
  assert.deepEqual(communityTrackListWhere(real, "  "), {
    userId: { not: DEMO_USER_ID_FALLBACK },
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
