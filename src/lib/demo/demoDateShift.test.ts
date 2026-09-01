/**
 * Run: `npm run test:demo-dates`
 *
 * Two jobs.
 *
 * 1. The arithmetic that decides where the demo season sits. Getting the sign wrong parks the
 *    whole season in the future, where "last 30 days" counts runs that haven't happened and the
 *    day verdict tries to reason about tomorrow.
 *
 * 2. The manifest, checked against schema.prisma itself. This is the test that actually earns
 *    its keep: a DateTime column added to `Run` a year from now would otherwise stay frozen
 *    while every other date moved, and the symptom — one number on one card disagreeing with
 *    the rest of the season — is close to undebuggable from the outside.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  DEMO_DATE_TABLES,
  DEMO_RECENCY_LAG_DAYS,
  DEMO_SHIFT_MIN_MS,
  DEMO_THREAD_AFTER_RUN_MS,
  computeDemoShiftMs,
  placeDemoThread,
  shouldApplyDemoShift,
} from "@/lib/demo/demoDateShift";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const iso = (s: string) => new Date(s);

test("a stale season is pulled forward to sit `lagDays` behind today", () => {
  // The measured production case: a snapshot ending 19 July, read on 25 August.
  const delta = computeDemoShiftMs({
    newestRunAt: iso("2026-07-19T06:48:00Z"),
    now: iso("2026-08-25T09:00:00Z"),
    lagDays: 2,
  });
  const moved = new Date(iso("2026-07-19T06:48:00Z").getTime() + delta);
  assert.equal(moved.toISOString(), iso("2026-08-23T09:00:00Z").toISOString());
  assert.ok(delta > 0, "a stale season moves forward");
});

test("a season that somehow sits in the future is pushed back, not left there", () => {
  const delta = computeDemoShiftMs({
    newestRunAt: iso("2026-09-10T00:00:00Z"),
    now: iso("2026-08-25T00:00:00Z"),
    lagDays: 2,
  });
  assert.ok(delta < 0, "a future season moves backward");
  const moved = new Date(iso("2026-09-10T00:00:00Z").getTime() + delta);
  assert.equal(moved.toISOString(), iso("2026-08-23T00:00:00Z").toISOString());
});

test("an unseeded box asks for no shift at all", () => {
  assert.equal(computeDemoShiftMs({ newestRunAt: null, now: new Date() }), 0);
  assert.equal(shouldApplyDemoShift(0), false);
});

test("small drift is not worth a write; a day's drift is", () => {
  assert.equal(shouldApplyDemoShift(2 * 60 * 60 * 1000), false);
  assert.equal(shouldApplyDemoShift(-2 * 60 * 60 * 1000), false);
  assert.equal(shouldApplyDemoShift(DEMO_SHIFT_MIN_MS), true);
  assert.equal(shouldApplyDemoShift(MS_PER_DAY), true);
  assert.equal(shouldApplyDemoShift(-MS_PER_DAY), true);
});

test("the default lag keeps the newest run inside every rolling window", () => {
  // 30-day windows are the tightest thing the dashboard reads. Anything close to that and the
  // demo would flicker between alive and dead depending on the hour the refresh ran.
  assert.ok(DEMO_RECENCY_LAG_DAYS >= 1, "not today — a demo with a run logged 'today' invites a live-data question");
  assert.ok(DEMO_RECENCY_LAG_DAYS <= 7);
});

/* ── Where a conversation lands ─────────────────────────────────────────────── */

test("conversations get their own anchor, so none of them land in the future", () => {
  /*
   * The bug this exists for, with the real numbers. The founder's newest RUN was 19 July and his
   * newest THREAD was 20 August — he stopped racing and kept asking questions. Moving everything
   * by the season delta (+34.8 days, anchored on the run) threw the history to 24 September.
   */
  const seasonDelta = 34.8 * MS_PER_DAY;
  const newestThread = iso("2026-08-20T00:00:00Z");
  assert.ok(
    newestThread.getTime() + seasonDelta > iso("2026-08-25T00:00:00Z").getTime(),
    "precondition: the season delta really does push the newest thread into the future",
  );

  // The thread set's own delta, anchored six hours behind now.
  const now = iso("2026-08-25T12:00:00Z");
  const threadSetDeltaMs = now.getTime() - 6 * 60 * 60 * 1000 - newestThread.getTime();
  const landed = newestThread.getTime() + placeDemoThread({
    threadAt: newestThread,
    threadSetDeltaMs,
    anchorRunAt: null,
  });
  assert.equal(new Date(landed).toISOString(), iso("2026-08-25T06:00:00Z").toISOString());
  assert.ok(landed < now.getTime(), "never in the future");
});

test("a general question keeps the set's delta exactly — gaps between conversations survive", () => {
  const delta = 5 * MS_PER_DAY;
  for (const at of ["2026-07-07T00:00:00Z", "2026-07-30T00:00:00Z", "2026-08-20T00:00:00Z"]) {
    assert.equal(
      placeDemoThread({ threadAt: iso(at), threadSetDeltaMs: delta, anchorRunAt: null }),
      delta,
    );
  }
});

test("a conversation about a run is pushed to sit AFTER that run", () => {
  // The thread would land 20 days before the run it discusses — its run moved by the larger
  // season delta, the thread by the smaller set delta.
  const threadAt = iso("2026-07-29T00:00:00Z");
  const threadSetDeltaMs = 5 * MS_PER_DAY; // → 2026-08-03
  const anchorRunAt = iso("2026-08-23T00:00:00Z");
  const delta = placeDemoThread({ threadAt, threadSetDeltaMs, anchorRunAt });
  const landed = new Date(threadAt.getTime() + delta);
  assert.ok(landed > anchorRunAt, "the conversation happens after the run");
  assert.equal(
    landed.toISOString(),
    iso("2026-08-23T02:00:00Z").toISOString(),
    "and lands just after it, not at some arbitrary later date",
  );
});

test("an anchored conversation already after its run is left alone", () => {
  const threadAt = iso("2026-08-20T00:00:00Z");
  const threadSetDeltaMs = 5 * MS_PER_DAY; // → 2026-08-25
  const anchorRunAt = iso("2026-08-23T00:00:00Z");
  assert.equal(
    placeDemoThread({ threadAt, threadSetDeltaMs, anchorRunAt }),
    threadSetDeltaMs,
    "no correction when the order is already right",
  );
});

test("the run-order rule can never push a conversation into the future", () => {
  /*
   * The ceiling on rule 2 is the newest run, which the season anchor already parked
   * DEMO_RECENCY_LAG_DAYS behind today. Worst case: a thread anchored to the newest run.
   */
  const now = iso("2026-08-25T12:00:00Z");
  const newestRunAt = new Date(now.getTime() - DEMO_RECENCY_LAG_DAYS * MS_PER_DAY);
  const threadAt = iso("2026-04-01T00:00:00Z");
  const delta = placeDemoThread({
    threadAt,
    threadSetDeltaMs: 0,
    anchorRunAt: newestRunAt,
  });
  const landed = threadAt.getTime() + delta;
  assert.ok(landed < now.getTime(), "still behind now");
  assert.equal(landed, newestRunAt.getTime() + DEMO_THREAD_AFTER_RUN_MS);
});

/* ── The manifest vs the schema ─────────────────────────────────────────────── */

/** Every DateTime column Prisma declares on a model, read straight from the schema. */
function dateColumnsOf(schema: string, model: string): string[] {
  const start = schema.indexOf(`\nmodel ${model} {`);
  assert.notEqual(start, -1, `model ${model} not found in schema.prisma`);
  const body = schema.slice(start, schema.indexOf("\n}", start));
  return [...body.matchAll(/^\s{2}(\w+)\s+DateTime\??/gm)].map((m) => m[1]);
}

test("every DateTime column on a demo-owned table is in the shift manifest", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  for (const spec of DEMO_DATE_TABLES) {
    const actual = dateColumnsOf(schema, spec.table);
    assert.deepEqual(
      [...spec.columns].sort(),
      [...actual].sort(),
      `${spec.table}: manifest and schema disagree — a date column would be left behind by the shift`,
    );
  }
});

test("the schema still has no @@map, so model names really are table names", () => {
  // The SQL interpolates `spec.table` directly as the Postgres identifier. If a @@map ever
  // lands, that assumption breaks silently and the UPDATE hits a table that doesn't exist.
  const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  assert.equal(schema.includes("@@map"), false, "a @@map would break the raw-SQL table names");
  assert.equal(schema.includes("@map("), false, "a @map would break the raw-SQL column names");
});

test("child tables are scoped through a parent that carries userId", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  for (const spec of DEMO_DATE_TABLES) {
    const start = schema.indexOf(`\nmodel ${spec.table} {`);
    const body = schema.slice(start, schema.indexOf("\n}", start));
    const fk = spec.scope === "user" ? "userId" : spec.scope === "run" ? "runId" : "threadId";
    assert.match(
      body,
      new RegExp(`^\\s{2}${fk}\\s+String`, "m"),
      `${spec.table} has no ${fk} column — its WHERE clause would fail`,
    );
  }
});
