import { test } from "node:test";
import assert from "node:assert/strict";
import { foldPathname, hrefPathname, trailSaysCameFrom } from "./returnTrail";

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

test("hrefPathname strips query and hash, refuses garbage gracefully", () => {
  assert.equal(hrefPathname("/cars?back=/paddock"), "/cars");
  assert.equal(hrefPathname("/analysis#trend"), "/analysis");
  assert.equal(hrefPathname("/runs/history?teamId=t1&driverIds=d1"), "/runs/history");
});
