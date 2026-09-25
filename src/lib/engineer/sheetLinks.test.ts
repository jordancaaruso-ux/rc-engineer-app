/**
 * Run: `npm run test:engineer-history` (node --import tsx --test).
 *
 * Setup-change links (founder design, 2026-09-24): the Engineer's words about changes it cannot
 * identify, linked to those boxes on the driver's own sheet. The driver data carries the link on
 * "N boxes not shown here", the answer carries it on its own words, and the page opens the two runs
 * the link was saved with.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addSheetLink,
  hideUnfinishedLink,
  readSheetLinks,
  sheetLinkHandleFromHref,
  sheetLinkHandlesIn,
  sheetLinksUsedIn,
  stripSheetLinks,
  type SheetLinkTarget,
} from "@/lib/engineer/sheetLinks";
import { changedWords, diffSheet, readSheet } from "@/lib/engineer/setupDiff";
import { renderHistoryBlock, renderRunLines, type HistoryRun } from "@/lib/engineer/historyShape";

test("a run's handle is the tail of its id, the same every time the run is linked", () => {
  const links = new Map<string, SheetLinkTarget>();
  const target = { runId: "cmugo47ng0007l904tby1yj6t", sinceRunId: "cmugo3aaa0001l904aaaaaaaa" };
  assert.equal(addSheetLink(links, target), "sheet-y1yj6t");
  assert.equal(addSheetLink(links, target), "sheet-y1yj6t", "linking the same pair again keeps its handle");
  assert.deepEqual(links.get("sheet-y1yj6t"), target);
});

test("two runs whose ids end alike get handles that tell them apart", () => {
  const links = new Map<string, SheetLinkTarget>();
  const a = addSheetLink(links, { runId: "aaaa11abcdef", sinceRunId: "p1" });
  const b = addSheetLink(links, { runId: "bbbb22abcdef", sinceRunId: "p2" });
  assert.equal(a, "sheet-abcdef");
  assert.equal(b, "sheet-2abcdef");
  assert.equal(links.size, 2);
});

test("the driver data links the boxes it cannot read, and nothing else changes", () => {
  const x4 = { pinion: "39", spur: "66", text20: "1", text34: "12" };
  const change = diffSheet(readSheet(x4), readSheet({ ...x4, text20: "1.1", text34: "14" }))!;
  assert.equal(changedWords(change, 8, "sheet-abc123"), "only [2 boxes not shown here](#sheet-abc123)");
  assert.equal(changedWords(change, 8), "only 2 boxes not shown here", "no link: the words exactly as before");
  const regear = diffSheet(readSheet(x4), readSheet({ ...x4, pinion: "40", text20: "1.1" }))!;
  assert.equal(changedWords(regear, 8, "sheet-abc123"), "pinion 39 → 40, and [1 box not shown here](#sheet-abc123)");
  // A change the Engineer reads in full has nothing to link.
  const readable = { arb_front: "1", toe_rear: "3", damper_oil_front: "450" };
  const moved = diffSheet(readSheet(readable), readSheet({ ...readable, arb_front: "1.1" }))!;
  assert.equal(changedWords(moved, 8, "sheet-abc123"), "arb front 1 → 1.1");
});

function run(over: Partial<HistoryRun>): HistoryRun {
  return {
    id: "run",
    dateYmd: "2026-09-20",
    clock: "10:00",
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
    unread: { text20: "1" },
    field: null,
    ...over,
  } as HistoryRun;
}

test("a range links each change on boxes it cannot read to that run and the one before it, and says what a link is", () => {
  const runs = [
    run({ id: "run-aaaaaa1", clock: "10:00" }),
    run({ id: "run-bbbbbb2", clock: "10:30", unread: { text20: "1.2" } }),
    run({ id: "run-cccccc3", clock: "11:00", unread: { text20: "1.2" } }),
  ];
  const links = new Map<string, SheetLinkTarget>();
  const block = renderHistoryBlock({ scopeLabel: "x", runs, omittedOlder: 0, lastSetup: null, sheetLinks: links }) ?? "";
  assert.match(block, /changed: only \[1 box not shown here\]\(#sheet-bbbbb2\)/);
  assert.match(block, /no setup change/, "nothing moved on the third run, so nothing to link");
  assert.deepEqual([...links.entries()], [["sheet-bbbbb2", { runId: "run-bbbbbb2", sinceRunId: "run-aaaaaa1" }]]);
  assert.match(block, /^Each link on those words, \(#sheet-…\), opens the driver's own sheet/m);

  // Without a collector the block reads exactly as it did before links existed.
  const plain = renderHistoryBlock({ scopeLabel: "x", runs, omittedOlder: 0, lastSetup: null }) ?? "";
  assert.doesNotMatch(plain, /#sheet-|Each link on those words/);
  assert.match(renderRunLines(runs)[2], /changed: only 1 box not shown here$/);
});

test("the answer keeps only the links it used, and a saved answer's links are read back safely", () => {
  const available = {
    "sheet-abc123": { runId: "r2", sinceRunId: "r1" },
    "sheet-def456": { runId: "r3", sinceRunId: "r2" },
  };
  const reply = "[Two changes I can't identify](#sheet-abc123) came before the gain. [Those](#sheet-ABC123) again, and [one I made up](#sheet-zzz999).";
  assert.deepEqual(sheetLinkHandlesIn(reply), ["sheet-abc123", "sheet-zzz999"]);
  assert.deepEqual(sheetLinksUsedIn(reply, available), { "sheet-abc123": { runId: "r2", sinceRunId: "r1" } });
  assert.deepEqual(readSheetLinks({ "sheet-abc123": { runId: "r2", sinceRunId: "r1" }, bogus: 1, "sheet-x1y2z3": { runId: 5 } }), {
    "sheet-abc123": { runId: "r2", sinceRunId: "r1" },
  });
  assert.deepEqual(readSheetLinks(null), {});
  assert.equal(sheetLinkHandleFromHref("#sheet-abc123"), "sheet-abc123");
  assert.equal(sheetLinkHandleFromHref("https://example.com/#sheet-abc123"), null);
  assert.equal(sheetLinkHandleFromHref("#top"), null);
  assert.equal(stripSheetLinks(reply), "Two changes I can't identify came before the gain. Those again, and one I made up.");
});

test("a link still arriving shows its words, never its brackets", () => {
  assert.equal(hideUnfinishedLink("Before 14:06, [two changes I can"), "Before 14:06, two changes I can");
  assert.equal(hideUnfinishedLink("Before 14:06, [two changes]"), "Before 14:06, two changes");
  assert.equal(hideUnfinishedLink("Before 14:06, [two changes](#sheet-4f"), "Before 14:06, two changes");
  assert.equal(hideUnfinishedLink("Before 14:06, [two changes]("), "Before 14:06, two changes");
  const whole = "Before 14:06, [two changes](#sheet-4f9k2m) came first.";
  assert.equal(hideUnfinishedLink(whole), whole, "a finished link is left for the renderer");
});
