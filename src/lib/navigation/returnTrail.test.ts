import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldPathname,
  hrefPathname,
  pushPathname,
  pushReturnsTo,
  trailParentAmong,
  trailSaysCameFrom,
  withScroll,
} from "./returnTrail";

/** "back:/x" is a move through history to /x (browser back, swipe, `router.back()`); the rest are pushes. */
function walk(paths: string[]): string[] {
  return paths.reduce<string[]>(
    (trail, p) =>
      p.startsWith("back:") ? foldPathname(trail, p.slice(5), true) : foldPathname(trail, p),
    []
  );
}

test("walking forward builds the trail in order", () => {
  assert.deepEqual(walk(["/analysis", "/runs/history", "/runs/abc"]), [
    "/analysis",
    "/runs/history",
    "/runs/abc",
  ]);
});

test("a query-only change is not a move", () => {
  // /runs/history?openGroup=… re-renders on the same pathname.
  assert.deepEqual(walk(["/analysis", "/runs/history", "/runs/history"]), [
    "/analysis",
    "/runs/history",
  ]);
});

test("history back to the entry underneath pops", () => {
  const trail = walk(["/analysis", "/runs/history", "/runs/abc", "back:/runs/history"]);
  assert.deepEqual(trail, ["/analysis", "/runs/history"]);
  // …so the next back knows Analysis is one step down: chains restore all the way up.
  assert.equal(trailSaysCameFrom(trail, "/analysis", "/runs/history"), true);
  assert.deepEqual(walk([...trail, "back:/analysis"]), ["/analysis"]);
});

test("history back several steps at once pops to that page; forward again is a new top", () => {
  // The browser's long-press back menu, straight from a run to Analysis.
  assert.deepEqual(walk(["/analysis", "/runs/history", "/runs/abc", "back:/analysis"]), ["/analysis"]);
  // Back, then forward: the page popped comes back on top.
  assert.deepEqual(walk(["/analysis", "/runs/history", "back:/analysis", "back:/runs/history"]), [
    "/analysis",
    "/runs/history",
  ]);
});

test("a link to the page two steps back is a push, not a return", () => {
  // Team page → Team sessions → Analysis → a teammate of that team: Team sessions again, by a
  // link. Read as history back, this erased Analysis and the corner back went to the team page
  // (review, 2026-09-26).
  const trail = walk(["/teams", "/teams/t1", "/runs/history", "/analysis", "/runs/history"]);
  assert.deepEqual(trail, ["/teams", "/teams/t1", "/runs/history", "/analysis", "/runs/history"]);
  const parents = ["/analysis", "/teams/t1"];
  assert.equal(trailParentAmong(trail, "/runs/history", parents), "/analysis");
  // Before the tracker has recorded the push, too.
  assert.equal(trailParentAmong(trail.slice(0, -1), "/runs/history", parents), "/analysis");
  assert.equal(trailSaysCameFrom(trail, "/analysis", "/runs/history"), true);
});

test("the trail is capped", () => {
  const many = Array.from({ length: 60 }, (_, i) => `/page-${i}`);
  assert.equal(walk(many).length, 40);
});

test("cameFrom answers both effect orderings", () => {
  // Before the tracker records the new page, the trail still ends at the referrer…
  assert.equal(trailSaysCameFrom(["/analysis"], "/analysis", "/runs/history"), true);
  // …after it records, the trail ends at the current page with the referrer underneath.
  assert.equal(trailSaysCameFrom(["/analysis", "/runs/history"], "/analysis", "/runs/history"), true);
});

test("cameFrom refuses when the driver arrived from somewhere else", () => {
  // Dock tab straight to the teammate list: back to Analysis must be a plain link.
  assert.equal(trailSaysCameFrom(["/", "/runs/history"], "/analysis", "/runs/history"), false);
  assert.equal(trailSaysCameFrom(["/"], "/analysis", "/runs/history"), false);
  // Cold launch: trail is just the landing page (or empty).
  assert.equal(trailSaysCameFrom(["/runs/history"], "/analysis", "/runs/history"), false);
  assert.equal(trailSaysCameFrom([], "/analysis", "/runs/history"), false);
});

test("a page with two parents returns to the one the driver came from", () => {
  const parents = ["/teams/t1"];
  // Settings → Teams → the team → Team sessions, before and after the tracker records it.
  assert.equal(
    trailParentAmong(["/settings", "/teams", "/teams/t1"], "/runs/history", parents),
    "/teams/t1"
  );
  assert.equal(
    trailParentAmong(["/settings", "/teams", "/teams/t1", "/runs/history"], "/runs/history", parents),
    "/teams/t1"
  );
  // History back from a run: the trail still ends at the run until the tracker catches up.
  assert.equal(
    trailParentAmong(["/teams/t1", "/runs/history", "/runs/abc"], "/runs/history", parents, true),
    "/teams/t1"
  );
  // Opened from Analysis, from another team's page, or cold: none of the candidates.
  assert.equal(trailParentAmong(["/analysis", "/runs/history"], "/runs/history", parents), null);
  assert.equal(trailParentAmong(["/teams/t2"], "/runs/history", parents), null);
  assert.equal(trailParentAmong([], "/runs/history", parents), null);
});

test("a pushed return is not read as history back, so the parent's arrow can't bounce", () => {
  const onSessions = ["/teams", "/teams/t1", "/runs/history"];
  // Read as history back, the push would pop, and the team page's arrow would walk history
  // straight back into team sessions.
  const misread = foldPathname(onSessions, "/teams/t1", true);
  assert.equal(trailSaysCameFrom(misread, "/teams", "/teams/t1"), true);
  // Recorded as a push, the team page knows it was reached from Sessions and links to Teams.
  const pushed = pushPathname(onSessions, "/teams/t1");
  assert.deepEqual(pushed, ["/teams", "/teams/t1", "/runs/history", "/teams/t1"]);
  assert.equal(trailSaysCameFrom(pushed, "/teams", "/teams/t1"), false);
  // The tracker's own fold of that push agrees, whether or not the pill recorded it first.
  assert.deepEqual(foldPathname(onSessions, "/teams/t1"), pushed);
  assert.deepEqual(foldPathname(pushed, "/teams/t1"), pushed);
});

test("a pushed back to a page the driver came through is a return, and keeps their place", () => {
  // The Sessions pill back to Analysis, before and after the tracker records Sessions.
  assert.equal(pushReturnsTo(["/analysis", "/runs/history"], "/runs/history", "/analysis"), true);
  assert.equal(pushReturnsTo(["/analysis"], "/runs/history", "/analysis"), true);
  // A one-team driver: back from the team page to Settings, past the Teams list that skipped itself.
  assert.equal(pushReturnsTo(["/settings", "/teams", "/teams/t1"], "/teams/t1", "/settings"), true);
  // Not returns: the team page opened cold, Sessions reached from the dashboard, or the same page.
  assert.equal(pushReturnsTo(["/teams/t1"], "/teams/t1", "/settings"), false);
  assert.equal(pushReturnsTo(["/", "/runs/history"], "/runs/history", "/analysis"), false);
  assert.equal(pushReturnsTo(["/analysis", "/runs/history"], "/runs/history", "/runs/history"), false);
});

test("the scroll map keeps each page's latest place, newest last, and stays small", () => {
  let map = withScroll({}, "/analysis", 412.6);
  map = withScroll(map, "/runs/history", 90);
  map = withScroll(map, "/analysis", 640);
  assert.deepEqual({ ...map }, { "/runs/history": 90, "/analysis": 640 });
  assert.deepEqual(Object.keys(map), ["/runs/history", "/analysis"]);
  assert.equal(withScroll({}, "/x", -5)["/x"], 0);
  for (let i = 0; i < 60; i++) map = withScroll(map, `/page-${i}`, i);
  assert.equal(Object.keys(map).length, 40);
  assert.equal(map["/page-59"], 59);
  assert.equal(map["/analysis"], undefined);
});

test("hrefPathname strips query and hash, refuses garbage gracefully", () => {
  assert.equal(hrefPathname("/cars?back=/paddock"), "/cars");
  assert.equal(hrefPathname("/analysis#trend"), "/analysis");
  assert.equal(hrefPathname("/runs/history?teamId=t1&driverIds=d1"), "/runs/history");
});
