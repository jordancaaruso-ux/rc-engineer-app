import test from "node:test";
import assert from "node:assert/strict";
import { extractPracticeSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import { groupLiveRcPracticeRows } from "@/lib/practiceField/practiceField";

/**
 * A LiveRC practice day page, cut down to its table — the markup is LiveRC's own (read off a
 * live page 2026-09-21), the drivers are invented.
 */
const PAGE_URL = "https://example.liverc.com/practice/?p=session_list&d=2026-09-19";
const PAGE = `
<table>
  <thead><tr><th>Driver<br />Class</th><th>Time</th><th>Laps <br />Length</th><th>Fast<br />Avg</th></tr></thead>
  <tbody>
    <tr>
      <td><a href="/practice/?p=view_session&id=900003">Tim Hillier</a><br /><small>ISTC 13.5T (7281046)</small></td>
      <td><div class="hidden">2026-09-19 18:14:42</div>6:14:42pm</td>
      <td data-sort="17">17<br />5:21</td>
      <td data-sort="15.613">Fast: 15.613<br />Avg: 18.899</td>
    </tr>
    <tr>
      <td><a href="/practice/?p=view_session&id=900002">Priya Nair</a><br /><small>ISTC 21.5T Pro (6620418)</small></td>
      <td><div class="hidden">2026-09-19 18:08:06</div>6:08:06pm</td>
      <td data-sort="10">10<br />3:20</td>
      <td data-sort="17.097">Fast: 17.097<br />Avg: 20.028</td>
    </tr>
    <tr>
      <td><a href="/practice/?p=view_session&id=900001">Tim Hillier</a><br /><small>ISTC 13.5T (7281046)</small></td>
      <td><div class="hidden">2026-09-19 17:40:00</div>5:40:00pm</td>
      <td data-sort="21">21<br />6:02</td>
      <td data-sort="15.402">Fast: 15.402<br />Avg: 17.310</td>
    </tr>
    <tr>
      <td><a href="/practice/?p=view_session&id=900000">Walk Up</a><br /><small>Open Practice</small></td>
      <td><div class="hidden">2026-09-19 17:01:00</div>5:01:00pm</td>
      <td data-sort="0">0<br />0:00</td>
      <td data-sort="0"></td>
    </tr>
  </tbody>
</table>`;

test("a practice row gives up its class, chip, lap count and fast lap", () => {
  const rows = extractPracticeSessions(PAGE, PAGE_URL);
  assert.equal(rows.length, 4);
  const first = rows[0]!;
  assert.equal(first.listLinkText, "Tim Hillier");
  assert.equal(first.className, "ISTC 13.5T");
  assert.equal(first.transponder, 7281046);
  assert.equal(first.lapCount, 17);
  assert.equal(first.fastLapSeconds, 15.613);
});

test("a row with no chip and no laps reads as nulls, not zeros pretending to be a lap", () => {
  const walkUp = extractPracticeSessions(PAGE, PAGE_URL)[3]!;
  assert.equal(walkUp.className, "Open Practice");
  assert.equal(walkUp.transponder, null);
  assert.equal(walkUp.fastLapSeconds, null);
});

test("the day folds into one row per driver, with the quicker session's lap on top", () => {
  const drivers = groupLiveRcPracticeRows(extractPracticeSessions(PAGE, PAGE_URL));
  assert.equal(drivers.length, 3);
  const tim = drivers.find((d) => d.transponder === "7281046")!;
  assert.equal(tim.siteName, "Tim Hillier");
  assert.equal(tim.sessionCount, 2);
  assert.equal(tim.bestLapSeconds, 15.402);
  assert.equal(tim.sessions![0]!.sessionUrl, "https://example.liverc.com/practice/?p=view_session&id=900003");
});
