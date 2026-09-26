import { test } from "node:test";
import assert from "node:assert/strict";
import {
  foldPathname,
  hrefPathname,
  pushPathname,
  trailParentAmong,
  trailSaysCameFrom,
} from "./returnTrail";

function walk(paths: string[]): string[] {
  return paths.reduce<string[]>((trail, p) => foldPathname(trail, p), []);
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

test("returning to the entry underneath pops (history back)", () => {
  const trail = walk(["/analysis", "/runs/history", "/runs/abc", "/runs/history"]);
  assert.deepEqual(trail, ["/analysis", "/runs/history"]);
  // …so the next back knows Analysis is one step down: chains restore all the way up.
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
  // Back from a run: the trail still ends at the run until the tracker catches up.
  assert.equal(
    trailParentAmong(["/teams/t1", "/runs/history", "/runs/abc"], "/runs/history", parents),
    "/teams/t1"
  );
  // Opened from Analysis, from another team's page, or cold: none of the candidates.
  assert.equal(trailParentAmong(["/analysis", "/runs/history"], "/runs/history", parents), null);
  assert.equal(trailParentAmong(["/teams/t2"], "/runs/history", parents), null);
  assert.equal(trailParentAmong([], "/runs/history", parents), null);
});

test("a pushed return is not read as history back, so the parent's arrow can't bounce", () => {
  const onSessions = ["/teams", "/teams/t1", "/runs/history"];
  // Read as history back, the push pops, and the team page's arrow would walk history straight
  // back into team sessions.
  const misread = foldPathname(onSessions, "/teams/t1");
  assert.equal(trailSaysCameFrom(misread, "/teams", "/teams/t1"), true);
  // Recorded as a push, the team page knows it was reached from Sessions and links to Teams.
  const pushed = pushPathname(onSessions, "/teams/t1");
  assert.deepEqual(pushed, ["/teams", "/teams/t1", "/runs/history", "/teams/t1"]);
  assert.equal(trailSaysCameFrom(pushed, "/teams", "/teams/t1"), false);
  // …and the tracker's own fold afterwards changes nothing.
  assert.deepEqual(foldPathname(pushed, "/teams/t1"), pushed);
});

test("hrefPathname strips query and hash, refuses garbage gracefully", () => {
  assert.equal(hrefPathname("/cars?back=/paddock"), "/cars");
  assert.equal(hrefPathname("/analysis#trend"), "/analysis");
  assert.equal(hrefPathname("/runs/history?teamId=t1&driverIds=d1"), "/runs/history");
});
