import assert from "node:assert/strict";
import { test } from "node:test";

import {
  liveRcEventsThatMayHoldDay,
  parseLiveRcEventListHtml,
  type LiveRcEventListRow,
} from "@/lib/lapWatch/liveRcIndexHtmlParse";

/** The shape of rrcsa.liverc.com/events/ on 2026-09-17, trimmed to four rows. */
const EVENTS_HTML = `
<table id="events" class="table table-striped" width="100%">
  <thead><tr><th>Event Name</th><th>Date</th><th># Entries</th><th># Drivers</th></tr></thead>
  <tbody>
    <tr>
      <td><a href="/results/?p=view_event&id=517224">RCRA 2025 EP State Titles</a></td>
      <td><span class="hidden">2026-09-12 00:00:00</span>Sep 12, 2026 to <br />Sep 13, 2026</td>
      <td>59</td><td>46</td>
    </tr>
    <tr>
      <td><a href="/results/?p=view_event&id=517768">RCRA 2026 EP State Titles</a></td>
      <td><span class="hidden">2026-09-11 00:00:00</span>Sep 11, 2026</td>
      <td>57</td><td>44</td>
    </tr>
    <tr>
      <td><a href="/results/?p=view_event&id=516697">LS CLUB ROUND 10 2026</a></td>
      <td><span class="hidden">2026-08-30 00:00:00</span>Aug 30, 2026</td>
      <td>19</td><td>15</td>
    </tr>
    <tr>
      <td><a href="/results/?p=view_event&id=502142">RCRA 2026IC ON Road SA Championship</a></td>
      <td><span class="hidden">2026-04-16 00:00:00</span>Apr 16, 2026 to <br />Apr 19, 2026</td>
      <td>28</td><td>20</td>
    </tr>
  </tbody>
  <tfoot><tr><th>Event Name</th><th>Date</th><th># Entries</th><th># Drivers</th></tr></tfoot>
</table>`;

test("reads every meeting with its dates", () => {
  const rows = parseLiveRcEventListHtml(EVENTS_HTML, "https://rrcsa.liverc.com/events/");
  assert.deepEqual(
    rows.map((r) => [r.eventId, r.startYmd, r.endYmd]),
    [
      ["517224", "2026-09-12", "2026-09-13"],
      ["517768", "2026-09-11", "2026-09-11"],
      ["516697", "2026-08-30", "2026-08-30"],
      ["502142", "2026-04-16", "2026-04-19"],
    ],
  );
  assert.equal(rows[1]!.eventHubUrl, "https://rrcsa.liverc.com/results/?p=view_event&id=517768");
  assert.equal(rows[1]!.name, "RCRA 2026 EP State Titles");
  assert.equal(rows[1]!.entries, 57);
});

const ev = (eventId: string, startYmd: string, endYmd = startYmd): LiveRcEventListRow => ({
  eventHubUrl: `https://x.liverc.com/results/?p=view_event&id=${eventId}`,
  eventId,
  name: eventId,
  startYmd,
  endYmd,
});

test("a meeting listed the day before still holds the day (its qualifiers ran on the 12th)", () => {
  const events = [ev("titles-sat-sun", "2026-09-12", "2026-09-13"), ev("titles-fri", "2026-09-11")];
  assert.deepEqual(
    liveRcEventsThatMayHoldDay(events, "2026-09-12").map((e) => e.eventId),
    ["titles-sat-sun", "titles-fri"],
  );
});

test("an older meeting is found though the club has raced since", () => {
  const events = [ev("club-round-11", "2026-09-14"), ev("titles", "2026-09-06"), ev("club-round-9", "2026-08-16")];
  assert.deepEqual(liveRcEventsThatMayHoldDay(events, "2026-09-06").map((e) => e.eventId), ["titles"]);
});

test("a long meeting that started more than a week before still spans the day", () => {
  const events = [ev("festival", "2026-09-01", "2026-09-12")];
  assert.deepEqual(liveRcEventsThatMayHoldDay(events, "2026-09-12").map((e) => e.eventId), ["festival"]);
});

test("meetings well after or well before the day are not opened", () => {
  const events = [ev("after", "2026-09-15"), ev("before", "2026-09-01")];
  assert.deepEqual(liveRcEventsThatMayHoldDay(events, "2026-09-12"), []);
  // The day after is kept: a round can be posted under the next day's listing.
  assert.equal(liveRcEventsThatMayHoldDay([ev("next", "2026-09-13")], "2026-09-12").length, 1);
});
