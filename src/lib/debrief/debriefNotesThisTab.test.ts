import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmDebriefSave,
  newestDebriefNote,
  openDebriefNote,
  rememberDebriefDraft,
} from "@/lib/debrief/debriefNotesThisTab";

/**
 * The debrief card is drawn afresh whenever the Sessions pane changes, from a page copy loaded
 * before any save. These pin what it must open with. The module's memory is shared across
 * tests, so each test uses its own meeting key.
 */

const T1 = "2026-09-17T06:00:00.000Z";
const T2 = "2026-09-17T06:05:00.000Z";
const T3 = "2026-09-17T06:10:00.000Z";

test("nothing saved in this tab: the page's copy", () => {
  const opened = openDebriefNote("day-a", { text: "From the page", updatedAtIso: T1 });
  assert.deepEqual(opened, {
    saved: { text: "From the page", updatedAtIso: T1 },
    boxText: "From the page",
  });
});

test("saved, then back to the day: the save, not the older page copy", () => {
  confirmDebriefSave("day-b", { text: "Rear toe helped", updatedAtIso: T2, savedAtIso: T2 });
  const opened = openDebriefNote("day-b", { text: "", updatedAtIso: null });
  assert.equal(opened.boxText, "Rear toe helped");
  assert.equal(opened.saved.updatedAtIso, T2);
});

test("a cleared note stays cleared against the page copy that still has it", () => {
  confirmDebriefSave("day-c", { text: "", updatedAtIso: null, savedAtIso: T2 });
  const opened = openDebriefNote("day-c", { text: "Old note", updatedAtIso: T1 });
  assert.deepEqual(opened, { saved: { text: "", updatedAtIso: null }, boxText: "" });
});

test("the page wins when the server wrote it after this tab's save (another device)", () => {
  const mine = { text: "Mine", updatedAtIso: T1, savedAtIso: T1 };
  assert.deepEqual(newestDebriefNote({ text: "Phone", updatedAtIso: T2 }, mine), {
    text: "Phone",
    updatedAtIso: T2,
  });
  // The page loaded after the same save carries the same stamp — still this tab's note.
  assert.deepEqual(newestDebriefNote({ text: "Mine", updatedAtIso: T1 }, mine), {
    text: "Mine",
    updatedAtIso: T1,
  });
});

test("an answer that lands after a newer one doesn't roll the note back", () => {
  confirmDebriefSave("day-d", { text: "Second", updatedAtIso: T3, savedAtIso: T3 });
  const newest = confirmDebriefSave("day-d", { text: "First", updatedAtIso: T2, savedAtIso: T2 });
  assert.deepEqual(newest, { text: "Second", updatedAtIso: T3 });
  assert.equal(openDebriefNote("day-d", { text: "", updatedAtIso: null }).boxText, "Second");
});

test("back before the save answered: the box opens on what was typed", () => {
  rememberDebriefDraft("day-e", "Typed on a slow signal");
  const opened = openDebriefNote("day-e", { text: "", updatedAtIso: null });
  assert.equal(opened.boxText, "Typed on a slow signal");
  assert.equal(opened.saved.text, "", "not yet saved, so the card sends it again");
});

test("a draft the server confirmed is dropped, trailing space and all", () => {
  rememberDebriefDraft("day-f", "Diff oil 7k  ");
  confirmDebriefSave("day-f", { text: "Diff oil 7k", updatedAtIso: T2, savedAtIso: T2 });
  // A later page copy from another device is no longer masked by the old draft.
  const opened = openDebriefNote("day-f", { text: "Diff oil 5k", updatedAtIso: T3 });
  assert.equal(opened.boxText, "Diff oil 5k");
});
