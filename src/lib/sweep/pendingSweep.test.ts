import assert from "node:assert/strict";
import { test } from "node:test";

import { pendingLooseFromImports, pendingSweepHref, pendingSweepLabel } from "@/lib/sweep/pendingSweep";

test("asks about the day the sessions ran, not today", () => {
  const p = pendingLooseFromImports([
    { id: "a", trackId: "t1", ymd: "2026-09-12" },
    { id: "b", trackId: "t1", ymd: "2026-09-12" },
    { id: "c", trackId: "t1", ymd: "2026-09-13" },
  ]);
  assert.deepEqual(p, { kind: "loose", importedLapTimeSessionId: "a", count: 2, trackId: "t1", ymd: "2026-09-12" });
  assert.equal(pendingSweepHref(p!), "/?whichCar=t1&ymd=2026-09-12");
  assert.equal(pendingSweepLabel(p!), "2 sessions found · which car?");
});

test("a session with no time is skipped for one the sheet can ask about", () => {
  const p = pendingLooseFromImports([
    { id: "x", trackId: "t1", ymd: null },
    { id: "a", trackId: "t1", ymd: "2026-09-12" },
  ]);
  assert.equal(p?.kind === "loose" && p.importedLapTimeSessionId, "a");
  assert.equal(p?.kind === "loose" && p.count, 1);
});

test("nothing askable opens by hand and does not promise a car question", () => {
  const p = pendingLooseFromImports([
    { id: "x", trackId: "t1", ymd: null },
    { id: "y", trackId: null, ymd: null },
  ]);
  assert.deepEqual(p, { kind: "loose", importedLapTimeSessionId: "x", count: 2, trackId: null, ymd: null });
  assert.equal(pendingSweepLabel(p!), "2 sessions found");
  assert.match(pendingSweepHref(p!), /^\/runs\/new\?importedLapTimeSessionId=x/);
});

test("no loose sessions, no row", () => {
  assert.equal(pendingLooseFromImports([]), null);
});
