/**
 * Run: `npx tsx --test src/lib/perf/routeKey.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeRoutePath, shouldSkipPerf } from "@/lib/perf/routeKey";

test("collapses cuid segments", () => {
  assert.equal(normalizeRoutePath("/runs/clx9abcdefghijklmnopqrst"), "/runs/[id]");
  assert.equal(
    normalizeRoutePath("/runs/clx9abcdefghijklmnopqrst/edit"),
    "/runs/[id]/edit"
  );
  assert.equal(
    normalizeRoutePath("/cars/clx9abcdefghijklmnopqrst/setups/clx1zyxwvutsrqponmlkjihg"),
    "/cars/[id]/setups/[id]"
  );
});

test("collapses uuid and numeric segments", () => {
  assert.equal(
    normalizeRoutePath("/api/teams/3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
    "/api/teams/[id]"
  );
  assert.equal(normalizeRoutePath("/tracks/12345"), "/tracks/[id]");
});

test("leaves real words alone", () => {
  assert.equal(normalizeRoutePath("/runs/history"), "/runs/history");
  assert.equal(normalizeRoutePath("/api/engineer/dashboard-suggestions"), "/api/engineer/dashboard-suggestions");
  assert.equal(normalizeRoutePath("/setup-documents/new"), "/setup-documents/new");
  // Long and starting with `c`, so it matches the cuid shape — only the digit guard
  // keeps it from being collapsed into `[id]`.
  assert.equal(
    normalizeRoutePath("/analysis/comparisonoverviewpanel"),
    "/analysis/comparisonoverviewpanel"
  );
  assert.equal(normalizeRoutePath("/setup/aggregations-debug"), "/setup/aggregations-debug");
});

test("strips query, hash, and trailing slash", () => {
  assert.equal(normalizeRoutePath("/runs/history?view=all&x=1"), "/runs/history");
  assert.equal(normalizeRoutePath("/runs/history#top"), "/runs/history");
  assert.equal(normalizeRoutePath("/runs/history/"), "/runs/history");
  assert.equal(normalizeRoutePath("/"), "/");
});

test("handles missing input", () => {
  assert.equal(normalizeRoutePath(null), "/");
  assert.equal(normalizeRoutePath(undefined), "/");
  assert.equal(normalizeRoutePath(""), "/");
});

test("caps absurd lengths", () => {
  const long = `/x${"y".repeat(400)}`;
  assert.ok(normalizeRoutePath(long).length <= 120);
});

test("skips the instrumentation's own surfaces", () => {
  // Self-exclusion: without this the beacon and the admin page sample themselves.
  assert.equal(shouldSkipPerf("/api/perf/beacon"), true);
  assert.equal(shouldSkipPerf("/admin/perf"), true);
  assert.equal(shouldSkipPerf("/admin/perf?days=30"), true);
  assert.equal(shouldSkipPerf("/api/health/db"), true);
  assert.equal(shouldSkipPerf("/api/_debug/version"), true);
  assert.equal(shouldSkipPerf("/_next/static/chunk.js"), true);
  assert.equal(shouldSkipPerf(null), true);
});

test("does not skip real routes", () => {
  assert.equal(shouldSkipPerf("/"), false);
  assert.equal(shouldSkipPerf("/runs/history"), false);
  assert.equal(shouldSkipPerf("/api/runs"), false);
  // Adjacent names must not be swallowed by a prefix match.
  assert.equal(shouldSkipPerf("/admin/review"), false);
  assert.equal(shouldSkipPerf("/api/perf-unrelated"), false);
});
