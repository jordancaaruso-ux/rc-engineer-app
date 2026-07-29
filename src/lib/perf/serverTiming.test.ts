/**
 * Run: `npx tsx --test src/lib/perf/serverTiming.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PerfStore } from "@/lib/perf/perfStore";
import { buildServerTimingHeader } from "@/lib/perf/serverTiming";

function store(overrides: Partial<PerfStore> = {}): PerfStore {
  return {
    kind: "api",
    route: "/api/runs",
    method: "GET",
    startedAt: 0,
    queryCount: 0,
    dbMs: 0,
    slowest: [],
    phases: {},
    seeded: true,
    registered: false,
    flushed: false,
    ...overrides,
  };
}

/** RFC 7230 token: no parens, spaces, equals, or quotes in a metric name. */
const LEGAL_HEADER = /^[A-Za-z0-9_-]+;dur=[\d.]+(;desc="[^"]*")?$/;

function assertLegal(header: string): void {
  for (const part of header.split(", ")) {
    assert.match(part, LEGAL_HEADER, `illegal Server-Timing part: ${part}`);
  }
}

test("always reports total and db", () => {
  const header = buildServerTimingHeader(store({ dbMs: 310.14, queryCount: 14 }), 412.35);
  assert.equal(header, 'total;dur=412.4, db;dur=310.1;desc="14q"');
  assertLegal(header);
});

test("sanitizes phase labels into legal tokens", () => {
  // This is the bug the test exists for: real labels in this repo contain parens and
  // equals signs, which would silently produce a malformed header and drop everything.
  const header = buildServerTimingHeader(
    store({ phases: { "fetchRunHistoryRows(take=40)": 280, "loadDashboardHomeModel": 180 } }),
    500
  );
  assertLegal(header);
  assert.ok(header.includes("fetchRunHistoryRows_take_40;dur=280"));
  assert.ok(header.includes("loadDashboardHomeModel;dur=180"));
});

test("drops duplicate sanitized names rather than emitting both", () => {
  // Chrome shows only the first entry for a repeated name, so a duplicate misleads.
  const header = buildServerTimingHeader(
    store({ phases: { "a(b)": 10, "a[b]": 20 } }),
    100
  );
  const names = header.split(", ").map((part) => part.split(";")[0]);
  assert.equal(new Set(names).size, names.length);
});

test("a phase named total or db cannot shadow the built-ins", () => {
  const header = buildServerTimingHeader(store({ phases: { total: 99, db: 99 } }), 100);
  assert.equal(header, 'total;dur=100, db;dur=0;desc="0q"');
});

test("clamps non-finite and negative durations", () => {
  const header = buildServerTimingHeader(
    store({ dbMs: Number.NaN, phases: { weird: -5, huge: Number.POSITIVE_INFINITY } }),
    Number.NaN
  );
  assertLegal(header);
  assert.ok(header.startsWith("total;dur=0"));
});

test("empty phases still produces a valid header", () => {
  assertLegal(buildServerTimingHeader(store(), 12));
});
