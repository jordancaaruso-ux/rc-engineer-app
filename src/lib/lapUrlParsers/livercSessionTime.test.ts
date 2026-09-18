import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  extractLiveRcRaceSessionWhenRaw,
  parseLiveRcSessionDisplayTimeToUtcIso,
} from "@/lib/lapUrlParsers/livercSessionTime";

/**
 * LiveRC prints the track's wall clock with no zone; it is stored as that wall clock written as
 * UTC whatever zone the server runs in. A dev box at UTC+9:30 used to store every time 9.5 hours
 * early (SA State Titles, 2026-09-16), so each case runs in several server zones.
 */

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const ZONES = ["UTC", "Australia/Adelaide", "Australia/Sydney", "America/Los_Angeles"];

const CASES: Array<[string, string]> = [
  ["Sep 12, 2026 at 9:48am", "2026-09-12T09:48:00.000Z"],
  ["Sep 12, 2026 at 5:29pm", "2026-09-12T17:29:00.000Z"],
  ["September 13, 2026 (Sunday) at 10:57:58am", "2026-09-13T10:57:58.000Z"],
  ["4/8/2025 2:30 PM", "2025-04-08T14:30:00.000Z"],
  ["Sep 11, 2026", "2026-09-11T00:00:00.000Z"],
  // A string that names its own zone is a real instant and is left alone.
  ["2026-09-12T09:48:00Z", "2026-09-12T09:48:00.000Z"],
];

for (const zone of ZONES) {
  test(`LiveRC wall clock is stored as written, server in ${zone}`, () => {
    process.env.TZ = zone;
    for (const [raw, want] of CASES) {
      assert.equal(parseLiveRcSessionDisplayTimeToUtcIso(raw), want, raw);
    }
  });
}

test("unreadable text gives null", () => {
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso("Race Results"), null);
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso(""), null);
});

/**
 * A LiveRC race result page, cut to the parts the date is read from. Every club's page carries
 * the same breadcrumb: club name, meeting name, then a calendar line.
 */
function raceResultPage(opts: { title: string; calendar: string }): string {
  return `<html><head><title>${opts.title}</title></head><body>
    <div class="row page-breadcrumb"><div class="col-lg-12">
      <h1 class="page-header"><span class="fa fa-road"></span> ${opts.title.split("::")[0]?.trim()}</h1>
      <div class="clearfix">
        <h3 class="page-header text-nowrap pull-left"><span class="fa fa-list-ol"></span> Round 3</h3>
        <h5 class="page-header text-nowrap pull-left"><span class="fa fa-calendar"></span> ${opts.calendar}</h5>
      </div>
    </div></div>
    <div class="panel-heading">ISTC 13.5 (Heat 1/1) Results [Q4 Race #3]</div>
  </body></html>`;
}

test("the race date is read off the breadcrumb calendar line", () => {
  // 194 of 217 race imports on file had no on-track date and showed their IMPORT time instead:
  // the old scan demanded a weekday in front of the date and LiveRC writes "Jul 15, 2026".
  const html = raceResultPage({
    title: "Boronia Radio Controlled Car Club inc :: Round 3 :: ISTC 13.5 (Heat 1/1) :: LiveRC",
    calendar: "Jul 15, 2026",
  });
  assert.equal(extractLiveRcRaceSessionWhenRaw(html), "Jul 15, 2026");
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso("Jul 15, 2026"), "2026-07-15T00:00:00.000Z");
});

test("a club with 'On' in its name is not mistaken for a date", () => {
  // "Bendigo On Road Radio Control Car Club" yielded "Road Radio Control Car Club" as the
  // session's time, because the title reader took everything after the first " on ".
  const html = raceResultPage({
    title:
      "Bendigo On Road Radio Control Car Club :: 6th September Club Day :: J Spec - A3-Main :: LiveRC",
    calendar: "Sep 6, 2026",
  });
  assert.equal(extractLiveRcRaceSessionWhenRaw(html), "Sep 6, 2026");
});

test("a meeting name full of numbers is not mistaken for a date", () => {
  const html = raceResultPage({
    title: "Shaw's RC Track :: 2026 Jato 4x4 Nationals :: 4x4 Spec Jato (Heat 1/4) :: LiveRC",
    calendar: "Sep 12, 2026 to Sep 13, 2026",
  });
  // A multi-day meeting prints a range; only its first day is taken — the page does not say
  // which day this heat ran, and day one is nearer than the day it was imported.
  assert.equal(extractLiveRcRaceSessionWhenRaw(html), "Sep 12, 2026");
});

test("a title that carries its own date and clock still wins over the calendar line", () => {
  const html = raceResultPage({
    title: "Club :: Round 1 :: ISTC Modified A-Main on Saturday, 8 April 2025 at 2:30 PM :: LiveRC",
    calendar: "Apr 8, 2025",
  });
  const raw = extractLiveRcRaceSessionWhenRaw(html);
  assert.equal(raw, "8 April 2025 2:30 PM");
  assert.equal(parseLiveRcSessionDisplayTimeToUtcIso(raw!), "2025-04-08T14:30:00.000Z");
});

test("a page with no date anywhere still gives null", () => {
  const html = raceResultPage({
    title: "Club :: Round 3 :: ISTC 13.5 (Heat 1/1) :: LiveRC",
    calendar: "",
  });
  assert.equal(extractLiveRcRaceSessionWhenRaw(html), null);
});
