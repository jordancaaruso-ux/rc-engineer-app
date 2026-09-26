/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * What a setup-change link opens: the boxes that moved, numbered in the order they sit on the
 * sheet, counted exactly as the Engineer's "changed" line counts them — and the message "Tell the
 * Engineer" sends. Plus the driver's own box names, saved to their car (founder, 2026-09-25:
 * "their car at once").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { namedChangesMessage, sheetChangeRows } from "@/lib/engineer/sheetChanges";
import { changedWords, diffSheet, readSheet, sheetMostlyUnread } from "@/lib/engineer/setupDiff";
import { renderHistoryBlock } from "@/lib/engineer/historyShape";
import { mergeCarSheetNames, readCarSheetNames } from "@/lib/engineer/carSheetNames";

const boxes = [
  { key: "pinion", pageNumber: 1, x: 0.3, y: 0.25 },
  { key: "text34", pageNumber: 1, x: 0.05, y: 0.4 },
  { key: "text20", pageNumber: 1, x: 0.05, y: 0.28 },
  { key: "text99", pageNumber: 2, x: 0.1, y: 0.1 },
];

test("the boxes that moved, in reading order, numbered as they are ringed", () => {
  const before = { pinion: "38", spur: "66", text20: "1.2", text34: "C=2.3", text99: "x", tires: "Sweep" };
  const after = { pinion: "39", spur: "66", text20: "1.4", text34: "C=2.5", text99: "x", tires: "Sweep" };
  const rows = sheetChangeRows({ before, after, boxes, savedNames: { text20: "front roll bar" } });
  assert.deepEqual(
    rows.map((r) => [r.number, r.key, r.before, r.after, r.known, r.savedName]),
    [
      [1, "pinion", "38", "39", "pinion", null],
      [2, "text20", "1.2", "1.4", null, "front roll bar"],
      [3, "text34", "C=2.3", "C=2.5", null, null],
    ]
  );
});

test("it rings exactly what the Engineer's changed line counted", () => {
  const before = { pinion: "38", spur: "66", text20: "1.2", text34: "12", notes: "x".repeat(80) };
  const after = { pinion: "39", spur: "66", text20: "1.4", text34: "12.0", notes: "y".repeat(80) };
  // "12" and "12.0" are the same setting; an 80-character note is not a value the Engineer reads.
  const rows = sheetChangeRows({ before, after, boxes });
  const change = diffSheet(readSheet(before), readSheet(after))!;
  assert.equal(changedWords(change, 8), "pinion 38 → 39, and 1 box not shown here");
  assert.equal(rows.filter((r) => !r.known).length, change.unread);
  assert.deepEqual(rows.map((r) => r.key), ["pinion", "text20"]);
});

test("a new battery, a note or the date is never ringed: the sheet shows what the Engineer counted", () => {
  const before = { pinion: "38", castor_front: "4", battery: "A", notes: "x", date: "2026-09-26" };
  const after = { pinion: "39", castor_front: "5", battery: "B", notes: "y", date: "2026-09-27" };
  const rows = sheetChangeRows({ before, after, boxes: [] });
  assert.deepEqual(rows.map((r) => r.key).sort(), ["castor_front", "pinion"]);
  const change = diffSheet(readSheet(before), readSheet(after))!;
  assert.equal(rows.filter((r) => !r.known).length, change.unread);
});

test("a box filled for the first time is a change from nothing, and a key with no box goes last, unnumbered", () => {
  const rows = sheetChangeRows({ before: { text20: "1" }, after: { text20: "1", text34: "5", legacy_key: "3" }, boxes });
  assert.deepEqual(
    rows.map((r) => [r.number, r.key, r.before, r.after]),
    [
      [1, "text34", null, "5"],
      [null, "legacy_key", null, "3"],
    ]
  );
});

test("Tell the Engineer sends the changes in the driver's words, the way the Engineer's data writes a change", () => {
  const changes = [
    { name: "Front roll bar", before: "1.2", after: "1.4" },
    { name: "  the front   spring ", before: "C=2.3", after: "C=2.5" },
    { name: "", before: "1", after: "2" },
  ];
  assert.equal(
    namedChangesMessage({ clock: "14:06", changes }),
    "Before my 14:06 run I changed the front roll bar 1.2 → 1.4 and the front spring C=2.3 → C=2.5."
  );
  assert.equal(
    namedChangesMessage({ clock: "9:05", changes: [{ name: "ARB front", before: "1", after: "2" }] }),
    "Before my 9:05 run I changed the ARB front 1 → 2."
  );
  assert.equal(
    namedChangesMessage({ clock: "12:15", dayLabel: "Sat 23 May", changes: [{ name: "rear toe", before: null, after: "3" }] }),
    "Before my 12:15 run on Sat 23 May I changed the rear toe — → 3."
  );
  assert.equal(
    namedChangesMessage({
      clock: null,
      changes: [
        { name: "a", before: "1", after: "2" },
        { name: "b", before: "1", after: "2" },
        { name: "c", before: "1", after: "2" },
      ],
    }),
    "Before that run I changed the a 1 → 2, the b 1 → 2 and the c 1 → 2."
  );
  assert.equal(namedChangesMessage({ clock: "14:06", changes: [{ name: " ", before: "1", after: "2" }] }), null);
});

test("a driver's names are saved to the car: set, replaced, forgotten, and never read from junk", () => {
  const first = mergeCarSheetNames(null, { text20: "  front   roll bar ", text34: "" }, "2026-09-25T08:00:00.000Z");
  assert.deepEqual(first, { text20: { name: "front roll bar", at: "2026-09-25T08:00:00.000Z" } });
  const second = mergeCarSheetNames(first, { text34: "front spring", text20: "" }, "2026-09-26T08:00:00.000Z");
  assert.deepEqual(second, { text34: { name: "front spring", at: "2026-09-26T08:00:00.000Z" } });
  assert.deepEqual(readCarSheetNames(second), { text34: "front spring" });
  assert.deepEqual(readCarSheetNames({ a: "not an object", b: { name: 3 }, c: { name: " rear bar " } }), { c: "rear bar" });
  assert.deepEqual(readCarSheetNames([1, 2]), {});
  assert.equal(mergeCarSheetNames(null, { k: "x".repeat(200) }, "t").k.name.length, 60);
});

test("once the driver names a box, the Engineer reads it by that name, and only the rest are counted", () => {
  const names = { text20: "front roll bar" };
  const x4 = { pinion: "39", spur: "66", text20: "1.2", text34: "C=2.3" };
  const moved = { ...x4, text20: "1.4", text34: "C=2.5" };
  const change = diffSheet(readSheet(x4, names), readSheet(moved, names))!;
  assert.deepEqual(change, { changes: ["front roll bar (named by the driver) 1.2 → 1.4"], unread: 1, named: 1 });
  assert.equal(
    changedWords(change, 8, "sheet-abc123"),
    "front roll bar (named by the driver) 1.2 → 1.4, and [1 box not shown here](#sheet-abc123)"
  );
  // Every box named: nothing left to link or count.
  const all = diffSheet(readSheet(x4, { ...names, text34: "front spring" }), readSheet(moved, { ...names, text34: "front spring" }))!;
  assert.equal(changedWords(all, 8, "sheet-abc123"), "front roll bar (named by the driver) 1.2 → 1.4, front spring (named by the driver) C=2.3 → C=2.5");
  // Naming boxes never turns a sheet the app cannot read into one it can.
  assert.equal(sheetMostlyUnread(readSheet(x4, { text20: "a", text34: "b" })), true);
  // A name for a box the app already reads is ignored: the app's own name stands.
  assert.deepEqual(readSheet(x4, { pinion: "the small gear" }).names, undefined);
  // No names: exactly the sheet as before.
  assert.deepEqual(readSheet(x4, {}), readSheet(x4));
});

test("the range and its setup section show the driver's names, and say once what they are", () => {
  const base = {
    dateYmd: "2026-09-20",
    trackName: "Bayside",
    carId: "car-1",
    carName: "X4",
    session: null,
    lapCount: 20,
    best: 15.5,
    top5: 15.7,
    fiveMin: null,
    rating: 7,
    tyreName: null,
    tyreTypeId: null,
    tyreRun: null,
    tyreAgeKnown: true,
    tyreStintId: null,
    airC: null,
    trackC: null,
    unconfirmed: false,
    tuning: { pinion: "39" },
    names: { text20: "front roll bar" },
    field: null,
  };
  const runs = [
    { ...base, id: "r1", clock: "10:00", unread: { text20: "1.2", text34: "5" } },
    { ...base, id: "r2", clock: "10:30", unread: { text20: "1.4", text34: "6" } },
  ];
  const block =
    renderHistoryBlock({
      scopeLabel: "x",
      runs,
      omittedOlder: 0,
      lastSetup: { carName: "X4", dateYmd: "2026-09-20", rows: ["front roll bar (named by the driver): 1.4", "pinion: 39"], unread: 1, partly: true, named: true },
    }) ?? "";
  assert.match(block, /changed: front roll bar \(named by the driver\) 1\.2 → 1\.4, and 1 box not shown here/);
  assert.equal(block.match(/^"\(named by the driver\)" is a box/gm)?.length, 1, "said once, in the header");
  assert.match(block, /The driver filled in 1 more box on this car's setup sheet that the app cannot read yet/);
});
