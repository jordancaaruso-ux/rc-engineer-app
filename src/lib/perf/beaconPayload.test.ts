/**
 * Run: `npx tsx --test src/lib/perf/beaconPayload.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_METRICS_PER_BEACON, parseBeaconPayload } from "@/lib/perf/beaconPayload";

function body(metrics: unknown[]): string {
  return JSON.stringify({ metrics });
}

test("parses a well-formed metric", () => {
  const rows = parseBeaconPayload(
    body([
      {
        name: "LCP",
        route: "/runs/clx9abcdefghijklmnopqrst",
        value: 1234.5,
        rating: "good",
        navigationType: "navigate",
        platform: "ios-native",
        metricId: "v4-123",
      },
    ]),
    "user_1",
    "dpl_abc"
  );

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    name: "LCP",
    // Route normalisation happens server-side too — a client cannot be trusted to do it.
    route: "/runs/[id]",
    value: 1234.5,
    rating: "good",
    navigationType: "navigate",
    fromRoute: null,
    platform: "ios-native",
    metricId: "v4-123",
    userId: "user_1",
    deployId: "dpl_abc",
  });
});

test("keeps soft-nav with its origin route", () => {
  const rows = parseBeaconPayload(
    body([{ name: "soft-nav", route: "/analysis", value: 180, fromRoute: "/runs/history" }]),
    "user_1",
    null
  );
  assert.equal(rows[0]?.name, "soft-nav");
  assert.equal(rows[0]?.fromRoute, "/runs/history");
});

test("rejects unknown metric names", () => {
  assert.deepEqual(parseBeaconPayload(body([{ name: "HACK", route: "/", value: 1 }]), "u", null), []);
});

test("rejects non-finite and negative values", () => {
  const rows = parseBeaconPayload(
    body([
      { name: "LCP", route: "/", value: Number.NaN },
      { name: "LCP", route: "/", value: -5 },
      { name: "LCP", route: "/", value: "800" },
      { name: "LCP", route: "/", value: 800 },
    ]),
    "u",
    null
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.value, 800);
});

test("clamps absurd values", () => {
  // A backgrounded tab reports LCP in the hours; storing it would wreck every percentile.
  const rows = parseBeaconPayload(body([{ name: "LCP", route: "/", value: 9_999_999 }]), "u", null);
  assert.equal(rows[0]?.value, 300_000);
});

test("caps the number of metrics per beacon", () => {
  const many = Array.from({ length: 50 }, (_, i) => ({
    name: "INP",
    route: "/",
    value: i + 1,
  }));
  assert.equal(parseBeaconPayload(body(many), "u", null).length, MAX_METRICS_PER_BEACON);
});

test("truncates long text fields", () => {
  const rows = parseBeaconPayload(
    body([{ name: "INP", route: "/", value: 1, rating: "x".repeat(500) }]),
    "u",
    null
  );
  assert.ok((rows[0]?.rating?.length ?? 0) <= 40);
});

test("returns empty for malformed bodies rather than throwing", () => {
  // The beacon route must never 4xx — a broken profiler should be invisible.
  assert.deepEqual(parseBeaconPayload("not json", "u", null), []);
  assert.deepEqual(parseBeaconPayload("null", "u", null), []);
  assert.deepEqual(parseBeaconPayload("[]", "u", null), []);
  assert.deepEqual(parseBeaconPayload(JSON.stringify({ metrics: "nope" }), "u", null), []);
  assert.deepEqual(parseBeaconPayload(body(["string", 42, null]), "u", null), []);
});
