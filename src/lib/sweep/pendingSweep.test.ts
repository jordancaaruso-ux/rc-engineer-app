import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingLooseFromImports, pendingSweepHref, pendingSweepLabel } from "@/lib/sweep/pendingSweep";

test("offers the day the runs ran, not today, and opens the sheet on it", () => {
  const p = pendingLooseFromImports([
    { id: "a", trackId: "t1", ymd: "2026-09-12" },
    { id: "b", trackId: "t1", ymd: "2026-09-12" },
    { id: "c", trackId: "t1", ymd: "2026-09-13" },
  ]);
  assert.deepEqual(p, { kind: "unlogged", importedLapTimeSessionId: "a", count: 2, trackId: "t1", ymd: "2026-09-12" });
  assert.equal(pendingSweepHref(p!), "/?unlogged=t1&ymd=2026-09-12");
  assert.equal(pendingSweepLabel(p!), "2 runs you didn't log");
});

test("one run reads singular", () => {
  const p = pendingLooseFromImports([{ id: "a", trackId: "t1", ymd: "2026-09-12" }]);
  assert.equal(pendingSweepLabel(p!), "1 run you didn't log");
});

test("a session with no time is skipped for one the sheet can list", () => {
  const p = pendingLooseFromImports([
    { id: "x", trackId: "t1", ymd: null },
    { id: "a", trackId: "t1", ymd: "2026-09-12" },
  ]);
  assert.equal(p?.importedLapTimeSessionId, "a");
  assert.equal(p?.count, 1);
});

test("nothing listable opens by hand and does not promise a sheet", () => {
  const p = pendingLooseFromImports([
    { id: "x", trackId: "t1", ymd: null },
    { id: "y", trackId: null, ymd: null },
  ]);
  assert.deepEqual(p, { kind: "unlogged", importedLapTimeSessionId: "x", count: 2, trackId: null, ymd: null });
  assert.equal(pendingSweepLabel(p!), "2 sessions found");
  assert.match(pendingSweepHref(p!), /^\/runs\/new\?importedLapTimeSessionId=x/);
});

test("no loose sessions, no row", () => {
  assert.equal(pendingLooseFromImports([]), null);
});
