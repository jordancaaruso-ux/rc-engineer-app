/**
 * Run: `npx tsx --test src/lib/runs/sessionsReturn.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BACK_PARAM,
  OPEN_GROUP_PARAM,
  SESSIONS_RETURN_KEY,
  safeSessionsBackHref,
} from "@/lib/runs/sessionsReturn";
import { buildRunHistoryHref } from "@/components/runs/RunHistoryViewMore";

test("safeSessionsBackHref keeps a Sessions URL with its filters intact", () => {
  const href = "/runs/history?teamId=t1&viewAll=1&openGroup=run_9&car=xb4";
  assert.equal(safeSessionsBackHref(href), href);
  assert.equal(safeSessionsBackHref("/runs/history"), "/runs/history");
});

test("safeSessionsBackHref refuses anything that isn't the Sessions route", () => {
  // Open-redirect shapes.
  assert.equal(safeSessionsBackHref("https://evil.example/x"), "/runs/history");
  assert.equal(safeSessionsBackHref("//evil.example/x"), "/runs/history");
  assert.equal(safeSessionsBackHref("javascript:alert(1)"), "/runs/history");
  // Same-origin but the wrong page — back must not become a general redirector.
  assert.equal(safeSessionsBackHref("/settings"), "/runs/history");
  assert.equal(safeSessionsBackHref("/runs/history-evil"), "/runs/history");
  assert.equal(safeSessionsBackHref("/runs/new?x=1"), "/runs/history");
  // Missing / malformed.
  assert.equal(safeSessionsBackHref(undefined), "/runs/history");
  assert.equal(safeSessionsBackHref("   "), "/runs/history");
});

test("safeSessionsBackHref takes the first value when the param repeats", () => {
  assert.equal(
    safeSessionsBackHref(["/runs/history?openGroup=a", "/settings"]),
    "/runs/history?openGroup=a"
  );
});

test("buildRunHistoryHref carries openGroup through view-all and filter links", () => {
  const withGroup = buildRunHistoryHref({
    viewAll: true,
    teamId: "team_1",
    openGroup: "run_7",
    filterQuery: "car=xb4",
  });
  const params = new URLSearchParams(withGroup.split("?")[1]);
  assert.equal(params.get(OPEN_GROUP_PARAM), "run_7");
  assert.equal(params.get("teamId"), "team_1");
  assert.equal(params.get("car"), "xb4");
  assert.equal(params.get("viewAll"), "1");
});

test("buildRunHistoryHref drops openGroup when there is no run to return to", () => {
  const href = buildRunHistoryHref({ openGroup: null, filterQuery: "openGroup=stale" });
  assert.ok(!href.includes(OPEN_GROUP_PARAM), `expected no openGroup in ${href}`);
});

test("buildRunHistoryHref never emits the legacy focusRun param, which redirects away", () => {
  const href = buildRunHistoryHref({ openGroup: "run_7", viewAll: true });
  assert.ok(!href.includes("focusRun"), `focusRun would bounce back to the run view: ${href}`);
});

test("param and storage names stay distinct from the legacy deep link", () => {
  assert.equal(OPEN_GROUP_PARAM, "openGroup");
  assert.equal(BACK_PARAM, "back");
  assert.notEqual(OPEN_GROUP_PARAM, "focusRun");
  assert.ok(SESSIONS_RETURN_KEY.startsWith("rc:"));
});
