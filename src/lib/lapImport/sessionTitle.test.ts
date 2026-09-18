/**
 * What an imported session is called — and what it must never be called.
 *
 * The regression this file exists for: the LiveRC race parser wrote a diagnostic marker into
 * `sessionHint.className`, and the library printed it, so 206 of one account's races were
 * titled `racer_laps_session_loaded`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { importedSessionTitle } from "./sessionTitle";
import { extractLiveRcRaceSessionNameFromHtml } from "../lapUrlParsers/livercSessionTime";

test("a detection label beats everything else", () => {
  assert.equal(
    importedSessionTitle({
      eventDetectionSessionLabel: "A-Main",
      eventRaceClass: "ISTC 13.5",
      driverName: "Sandy Iavazzo",
    }),
    "A-Main"
  );
});

test("the class names the session when there is no label", () => {
  assert.equal(importedSessionTitle({ eventRaceClass: "ISTC 13.5" }), "ISTC 13.5");
});

test("the parser's hint names it when nothing else does", () => {
  assert.equal(
    importedSessionTitle({
      parsedPayload: { sessionHint: { name: null, className: "ISTC Modified A3-Main" } },
      driverCount: 11,
    }),
    "ISTC Modified A3-Main"
  );
});

test("a machine marker is never a title", () => {
  assert.equal(
    importedSessionTitle({
      parsedPayload: { sessionHint: { name: null, className: "racer_laps_session_loaded" } },
      driverCount: 3,
    }),
    "Race"
  );
  assert.equal(
    importedSessionTitle({
      parsedPayload: { sessionHint: { name: null, className: "racer_laps_embed_failed" } },
      driverCount: 1,
      driverName: "Sandy Iavazzo",
    }),
    "Sandy Iavazzo"
  );
});

test("a real class name that happens to be lowercase survives", () => {
  assert.equal(importedSessionTitle({ eventRaceClass: "13.5 stock" }), "13.5 stock");
  assert.equal(importedSessionTitle({ eventRaceClass: "Mod" }), "Mod");
});

test("a driver titles a single-driver sheet, never a field", () => {
  assert.equal(importedSessionTitle({ driverName: "Jordan Caruso", driverCount: 1 }), "Jordan Caruso");
  assert.equal(importedSessionTitle({ driverName: "Jordan Caruso", driverCount: 9 }), "Race");
});

test("LiveRC prints the race name in the page title", () => {
  const html =
    "<html><head><title>TFTR :: TFTR 2026 Championship Round 10 - Whale CCW :: ISTC Modified A3-Main :: LiveRC</title></head><body></body></html>";
  assert.equal(extractLiveRcRaceSessionNameFromHtml(html), "ISTC Modified A3-Main");
});

test("a heat number rides along with the class", () => {
  const html =
    "<html><head><title>BRCC :: Club Day 4 :: ISTC 13.5 (Heat 1/1) :: LiveRC</title></head></html>";
  assert.equal(extractLiveRcRaceSessionNameFromHtml(html), "ISTC 13.5 (Heat 1/1)");
});

test("a title with no session segment yields nothing rather than the meeting's name", () => {
  assert.equal(
    extractLiveRcRaceSessionNameFromHtml("<html><head><title>TFTR :: LiveRC</title></head></html>"),
    null
  );
  assert.equal(
    extractLiveRcRaceSessionNameFromHtml(
      "<html><head><title>TFTR :: Club Day 4 :: LiveRC</title></head></html>"
    ),
    null
  );
});

test("a Speedhive practice session named after its own start time is not titled with a date", () => {
  // The feed names every practice session by when it started, so 10 of 13 rows in the library
  // were TITLED with a date — above a second, different date in the row beneath. It is not even
  // consistently ordered: most read day-first, at least one month-first (2026-09-18).
  for (const name of ["12/10/2025, 01:03 pm", "10/12/2025, 1:18:19 PM", "28/09/2025, 05:12 pm"]) {
    assert.equal(
      importedSessionTitle({
        parsedPayload: { sessionHint: { name } },
        driverCount: 1,
      }),
      "Practice",
      name
    );
  }
});

test("a numbered practice session says which one it was", () => {
  assert.equal(
    importedSessionTitle({
      parsedPayload: { sessionHint: { name: "12/10/2025, 01:03 pm" } },
      driverName: "Jordan Caruso",
      driverCount: 1,
      sessionNumber: 2,
    }),
    "Practice 2"
  );
});

test("the number outranks the driver's name, which outranks the bare word", () => {
  const base = { driverName: "Jordan Caruso", driverCount: 1 };
  assert.equal(importedSessionTitle({ ...base, sessionNumber: 3 }), "Practice 3");
  assert.equal(importedSessionTitle(base), "Jordan Caruso");
  assert.equal(importedSessionTitle({ driverCount: 1 }), "Practice");
});

test("a real session name that merely contains digits is untouched", () => {
  for (const name of ["ISTC 13.5", "4x4 Spec Jato (Heat 1/4)", "Heat 25 Qualy 2", "A-Main"]) {
    assert.equal(importedSessionTitle({ parsedPayload: { sessionHint: { name } } }), name);
  }
});
