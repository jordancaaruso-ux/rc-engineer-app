/**
 * Run: `npm run test:engineer-history`.
 *
 * The tool's text is what the Engineer reads about everyone else's practice, so the grouping
 * (your class first, fastest first, sessions earliest first) and the "(you)" mark must hold.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIVERC_PRACTICE_TOOL_DEFINITION,
  parsePracticeDayArg,
  renderLivercPracticeDay,
} from "@/lib/engineer/livercPracticeTool";
import type { PracticeFieldDriver } from "@/lib/practiceField/practiceField";

function driver(over: Partial<PracticeFieldDriver> & { siteName: string }): PracticeFieldDriver {
  const sessions = over.sessions ?? [];
  return {
    key: over.siteName,
    transponder: null,
    className: null,
    sessionCount: sessions.length,
    latestIso: null,
    bestLapSeconds: sessions.reduce<number | null>((b, s) => (s.bestLapSeconds != null && (b == null || s.bestLapSeconds < b) ? s.bestLapSeconds : b), null),
    isViewer: false,
    ...over,
    sessions,
  };
}
const URL = "https://rrcsa.liverc.com/practice/?p=view_session&id=1";
const s = (iso: string, laps: number, best: number) => ({ sessionUrl: URL, sessionCompletedAtIso: iso, lapCount: laps, bestLapSeconds: best, importedSessionId: null });

test("the definition is a strict function tool with one required day argument", () => {
  assert.equal(LIVERC_PRACTICE_TOOL_DEFINITION.type, "function");
  assert.equal(LIVERC_PRACTICE_TOOL_DEFINITION.function.strict, true);
  assert.deepEqual(LIVERC_PRACTICE_TOOL_DEFINITION.function.parameters.required, ["day"]);
});

test("the day argument is checked, not trusted", () => {
  assert.equal(parsePracticeDayArg('{"day":"2026-09-12"}'), "2026-09-12");
  assert.equal(parsePracticeDayArg('{"day":" 2026-09-12 "}'), "2026-09-12");
  assert.equal(parsePracticeDayArg('{"day":"12/09/2026"}'), null);
  assert.equal(parsePracticeDayArg('{"day":"2026-13-40"}'), null);
  assert.equal(parsePracticeDayArg("not json"), null);
  assert.equal(parsePracticeDayArg("{}"), null);
});

test("render: your class first, fastest driver first, sessions earliest first, you marked", () => {
  const out = renderLivercPracticeDay({
    trackName: "Radio Racing Cars SA",
    dayYmd: "2026-09-12",
    myClass: "ISTC 13.5t",
    drivers: [
      driver({ siteName: "Some Buggy Guy", className: "1/8 Buggy", sessions: [s("2026-09-12T09:30:00Z", 20, 30.1)] }),
      driver({ siteName: "Timothy Hilyear", className: "ISTC 13.5t", sessions: [s("2026-09-12T08:59:00Z", 16, 17.8)] }),
      driver({
        siteName: "Jordan Caruso",
        transponder: "1234567",
        className: "ISTC 13.5t",
        isViewer: true,
        sessions: [s("2026-09-12T12:59:00Z", 18, 17.39), s("2026-09-12T08:58:00Z", 15, 17.72)],
      }),
    ],
  });
  assert.match(out, /^DRIVER DATA — LIVERC PRACTICE at Radio Racing Cars SA, 2026-09-12, read from LiveRC just now\. 3 drivers, 4 sessions\./);
  const lines = out.split("\n");
  const istc = lines.indexOf("ISTC 13.5t — 2 drivers");
  const buggy = lines.indexOf("1/8 Buggy — 1 driver");
  assert.ok(istc > 0 && buggy > istc, "own class listed first");
  // LiveRC practice times are the track's own clock, stored as-if-UTC: printed as they are, never
  // shifted by a zone (the 2026-09-22 build printed Adelaide's 08:58 practice as 18:28).
  assert.equal(lines[istc + 1], "  Jordan Caruso (you): 08:58 15 laps fastest 17.72 · 12:59 18 laps fastest 17.39");
  assert.equal(lines[istc + 2], "  Timothy Hilyear: 08:59 16 laps fastest 17.80");
});

test("render: an empty day says so in words", () => {
  const out = renderLivercPracticeDay({ trackName: "Keilor", dayYmd: "2026-09-13", myClass: null, drivers: [] });
  assert.match(out, /Nobody's practice is listed for that day/);
});
