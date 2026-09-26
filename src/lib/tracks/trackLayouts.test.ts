/**
 * Run: `npm run test:track-layouts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { findLayoutByName, layoutIdsToDelete, normalizeLayoutName } from "@/lib/tracks/trackLayouts";

test("normalizeLayoutName trims and folds runs of spaces", () => {
  assert.equal(normalizeLayoutName("  Club   layout \t"), "Club layout");
  assert.equal(normalizeLayoutName("   "), "");
});

test("findLayoutByName matches regardless of case and spacing", () => {
  const layouts = [
    { id: "a", name: "Whale" },
    { id: "b", name: "Club layout" },
  ];
  assert.equal(findLayoutByName(layouts, "club  LAYOUT ")?.id, "b");
  assert.equal(findLayoutByName(layouts, "whale")?.id, "a");
});

test("findLayoutByName finds nothing for a new name or a blank one", () => {
  const layouts = [{ id: "a", name: "Whale" }];
  assert.equal(findLayoutByName(layouts, "Reverse"), null);
  assert.equal(findLayoutByName(layouts, "   "), null);
  // A prefix is a different layout, not the same one.
  assert.equal(findLayoutByName(layouts, "Whale reverse"), null);
});

test("layoutIdsToDelete removes only what the page loaded and took out", () => {
  // The page loaded a and b, removed b. c was added by another driver after it loaded.
  const deleted = layoutIdsToDelete(["a", "b", "c"], new Set(["a"]), new Set(["a", "b"]));
  assert.deepEqual(deleted, ["b"]);
});

test("layoutIdsToDelete without knownIds removes every missing layout, as before", () => {
  assert.deepEqual(layoutIdsToDelete(["a", "b", "c"], new Set(["a"]), null), ["b", "c"]);
});

test("layoutIdsToDelete keeps everything the save sends back", () => {
  assert.deepEqual(layoutIdsToDelete(["a", "b"], new Set(["a", "b"]), new Set(["a", "b"])), []);
});
