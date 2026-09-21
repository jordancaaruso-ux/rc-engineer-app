import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPracticeField,
  groupLiveRcPracticeRows,
  groupMylapsActivities,
  importedSessionIsPractice,
  practiceColumnName,
  practiceDriverDisplayName,
  practiceQueryAsTransponder,
  runOwnerName,
  type LiveRcPracticeRowInput,
} from "@/lib/practiceField/practiceField";

function row(over: Partial<LiveRcPracticeRowInput> & { id: string }): LiveRcPracticeRowInput {
  return {
    driverName: `${over.listLinkText ?? "Someone"}Modified (1)`,
    listLinkText: "Someone",
    sessionUrl: `https://x.liverc.com/practice/?p=view_session&id=${over.id}`,
    sessionCompletedAtIso: "2026-09-19T10:00:00.000Z",
    className: "Modified",
    transponder: null,
    lapCount: 20,
    fastLapSeconds: 14,
    ...over,
  };
}

test("LiveRC rows fold into one driver per chip, sessions newest first, best lap carried up", () => {
  const drivers = groupLiveRcPracticeRows([
    row({ id: "1", listLinkText: "Tim Hillier", transponder: 7281046, fastLapSeconds: 13.9, sessionCompletedAtIso: "2026-09-19T09:00:00.000Z" }),
    row({ id: "2", listLinkText: "Priya Nair", transponder: 6620418, fastLapSeconds: 13.2 }),
    row({ id: "3", listLinkText: "Tim Hillier", transponder: 7281046, fastLapSeconds: 13.4, sessionCompletedAtIso: "2026-09-19T11:00:00.000Z" }),
  ]);
  assert.equal(drivers.length, 2);
  const tim = drivers.find((d) => d.transponder === "7281046")!;
  assert.equal(tim.siteName, "Tim Hillier");
  assert.equal(tim.sessionCount, 2);
  assert.equal(tim.bestLapSeconds, 13.4);
  assert.deepEqual(tim.sessions!.map((s) => s.sessionUrl.slice(-1)), ["3", "1"]);
});

test("a loaner chip worn by two people stays two rows", () => {
  const drivers = groupLiveRcPracticeRows([
    row({ id: "1", listLinkText: "Sam Okafor", transponder: 1111111 }),
    row({ id: "2", listLinkText: "Alex Moore", transponder: 1111111 }),
  ]);
  assert.equal(drivers.length, 2);
});

test("a driver who ran two classes on one chip says both", () => {
  const [driver] = groupLiveRcPracticeRows([
    row({ id: "1", listLinkText: "Jo Whitfield", transponder: 9036821, className: "Stock 13.5" }),
    row({ id: "2", listLinkText: "Jo Whitfield", transponder: 9036821, className: "Modified" }),
  ]);
  assert.equal(driver!.className, "Stock 13.5 / Modified");
});

test("MYLAPS: one row per chip, and a label that is only the number is not a name", () => {
  const drivers = groupMylapsActivities([
    { chipCode: "7281046", chipLabel: "T HILLIER 2", endTime: "2026-09-19T03:00:00Z" },
    { chipCode: "7281046", chipLabel: "T HILLIER 2", endTime: "2026-09-20T03:00:00Z" },
    { chipCode: "2450937", chipLabel: "2450937", endTime: "2026-09-18T03:00:00Z" },
    { chipCode: "9036821", endTime: "2026-09-17T03:00:00Z" },
    { chipLabel: "No chip at all" },
  ]);
  assert.equal(drivers.length, 3);
  const tim = drivers.find((d) => d.transponder === "7281046")!;
  assert.equal(tim.sessionCount, 2);
  assert.equal(tim.latestIso, "2026-09-20T03:00:00.000Z");
  assert.equal(tim.sessions, null);
  assert.equal(drivers.find((d) => d.transponder === "2450937")!.siteName, null);
  assert.equal(drivers.find((d) => d.transponder === "9036821")!.siteName, null);
});

test("your saved name beats the site's label, and a nameless chip reads as its number", () => {
  const drivers = groupMylapsActivities([
    { chipCode: "7281046", chipLabel: "T HILLIER 2" },
    { chipCode: "2450937" },
  ]);
  const saved = [{ name: "Tim", transponder: "7281046" }];
  assert.equal(practiceDriverDisplayName(drivers[0]!, saved), "Tim");
  assert.equal(practiceDriverDisplayName(drivers[0]!, []), "T HILLIER 2");
  assert.equal(practiceDriverDisplayName(drivers[1]!, saved), "Transponder 2450937");
});

test("search finds your name, their label, or the number; saved drivers lead, then the quickest", () => {
  const drivers = groupLiveRcPracticeRows([
    row({ id: "1", listLinkText: "Priya Nair", transponder: 6620418, fastLapSeconds: 13.0 }),
    row({ id: "2", listLinkText: "Timothy Hillier", transponder: 7281046, fastLapSeconds: 13.6 }),
    row({ id: "3", listLinkText: "Marcus Webb", transponder: 3915572, fastLapSeconds: 13.3 }),
  ]);
  const saved = [{ name: "Tim", transponder: "7281046" }];
  const names = (query: string, onlyTransponder: string | null = null) =>
    filterPracticeField(drivers, { query, onlyTransponder, saved }).map((d) => d.siteName);

  assert.deepEqual(names(""), ["Timothy Hillier", "Priya Nair", "Marcus Webb"]);
  assert.deepEqual(names("tim"), ["Timothy Hillier"]);
  assert.deepEqual(names("timothy"), ["Timothy Hillier"]);
  assert.deepEqual(names("6620"), ["Priya Nair"]);
  assert.deepEqual(names("pri"), ["Priya Nair"]);
  assert.deepEqual(names("anything", "3915572"), ["Marcus Webb"]);
  assert.deepEqual(names("nobody"), []);
});

test("only a bare run of digits is treated as a transponder to look up", () => {
  assert.equal(practiceQueryAsTransponder("5530219"), "5530219");
  assert.equal(practiceQueryAsTransponder(" 5530219 "), "5530219");
  assert.equal(practiceQueryAsTransponder("553"), null);
  assert.equal(practiceQueryAsTransponder("tim 5530219"), null);
});

test("an imported session is practice or race by where it came from", () => {
  assert.equal(importedSessionIsPractice("https://tftr.liverc.com/practice/?p=view_session&id=24639316"), true);
  assert.equal(importedSessionIsPractice("https://speedhive.mylaps.com/practice/4591/activities/1/sessions/2"), true);
  assert.equal(importedSessionIsPractice("https://tftr.liverc.com/results/?p=view_race_result&id=1"), false);
  assert.equal(importedSessionIsPractice("https://speedhive.mylaps.com/sessions/123"), false);
  assert.equal(importedSessionIsPractice("myrcm-pdf://abc/file.pdf"), false);
  assert.equal(importedSessionIsPractice(null), false);
});

test("a brought-in column is headed by your name for them, then the list's, the site's, the number", () => {
  const saved = [{ name: "Tim", transponder: "7281046" }];
  assert.equal(practiceColumnName({ transponder: "7281046", saved, siteName: "T HILLIER 2", importName: "20 Sept, 6:32 PM" }), "Tim");
  assert.equal(practiceColumnName({ transponder: "2450937", saved, visitName: "Dale" }), "Dale");
  assert.equal(practiceColumnName({ transponder: "2450937", saved, siteName: "BC Racing" }), "BC Racing");
  assert.equal(practiceColumnName({ transponder: "2450937", saved, importName: "20 Sept, 6:32 PM" }), "Transponder 2450937");
  assert.equal(practiceColumnName({ transponder: null, saved, importName: "David Calwell" }), "David Calwell");
});

test("a run's owner is its driver's name, and never a placeholder", () => {
  assert.equal(runOwnerName("Jordan Caruso"), "Jordan Caruso");
  assert.equal(runOwnerName("  Jordan   Caruso "), "Jordan Caruso");
  assert.equal(runOwnerName("Me"), null);
  assert.equal(runOwnerName("Driver"), null);
  assert.equal(runOwnerName(""), null);
  assert.equal(runOwnerName(null), null);
});
