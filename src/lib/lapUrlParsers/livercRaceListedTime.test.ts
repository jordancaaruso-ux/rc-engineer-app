/**
 * Run: `node --conditions=react-server --import tsx --test src/lib/lapUrlParsers/livercRaceListedTime.test.ts`
 *
 * (`react-server`: the lookup is `server-only`.) The pages below are LiveRC's own markup, cut to
 * what is read: Team JOYBOX's 2026 JMRCA EP-T Nationals (a two-day meeting, 12-13 Sept 2026), as
 * fetched on 2026-09-26. LiveRC's list said "Race 1: EP-T STOCK A1-Main · Sep 13, 2026 at 1:19pm";
 * the race page itself says only "Sep 12, 2026 to Sep 13, 2026", and the import filed the Sunday
 * final at 12:00 am on the Saturday (test drive report 30-1).
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  extractLiveRcRaceMeeting,
  listedTimeOfLiveRcRace,
  liveRcHubsForRaceMeeting,
} from "./livercRaceListedTime";
import { importLiveRcRaceResult } from "./livercRaceResult";
import { parseLiveRcEventListHtml } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { extractRaceSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import { isDateOnlyTrackTime } from "@/lib/lapImport/trackClock";
import { withLiveRcRound } from "@/lib/lapImport/labels";

function racePage(opts: { meeting: string; calendar: string }): string {
  return `<html><head><title>Team JOYBOX :: ${opts.meeting} :: EP-T STOCK A1-Main :: LiveRC</title></head><body>
<div class="row page-breadcrumb"><div class="col-lg-12">
  <h1 class="page-header"><span class="fa fa-road"></span> Team JOYBOX</h1>
  <div class="clearfix">
    <h3 class="page-header text-nowrap pull-left"><span class="fa fa-list-ol"></span> ${opts.meeting}</h3>
    <h5 class="page-header text-nowrap pull-left"><span class="fa fa-calendar"></span> ${opts.calendar}</h5>
  </div>
</div></div>
<div class="panel-heading"><i class="fa fa-trophy"></i> EP-T STOCK A1-Main Results [M1 Race #1]</div>
<script type="text/javascript">
  var racerLaps = {};
  racerLaps[813689] = {
    'driverName' : 'KAWASHIMA',
    'laps' : [
      { 'lapNum' : '0', 'pos' : '1', 'time' : '0' },
      { 'lapNum' : '1', 'pos' : '1', 'time' : '10.351' },
      { 'lapNum' : '2', 'pos' : '1', 'time' : '10.074' }
    ]
  };
  racerLaps[813700] = {
    'driverName' : 'OHTSUKA',
    'laps' : [
      { 'lapNum' : '1', 'pos' : '5', 'time' : '10.912' },
      { 'lapNum' : '2', 'pos' : '5', 'time' : '10.655' }
    ]
  };
</script>
<table class="table table-striped race_result"><tbody>
  <tr><td>1</td><td><span class="driver_name">KAWASHIMA</span>
    <br /><a href="#" data-driver-id="813689" class="driver_laps">View Laps</a></td><td>2/0:20.425</td></tr>
  <tr><td>5</td><td><span class="driver_name">OHTSUKA</span>
    <br /><a href="#" data-driver-id="813700" class="driver_laps">View Laps</a></td><td>2/0:21.567</td></tr>
</tbody></table>
</body></html>`;
}

const JMRCA = "2026 1/10EP-T JMRCA Japan National";

function eventsPage(origin: string): string {
  return `<table id="events"><tbody>
  <tr>
    <td><a href="/results/?p=view_event&id=517813">${JMRCA}</a></td>
    <td><span class="hidden">2026-09-12 08:00:00</span>Sep 12, 2026 to <br />Sep 13, 2026</td>
    <td>79</td><td>61</td>
  </tr>
  <tr>
    <td><a href="/results/?p=view_event&id=513424">JTCC 2026 R3 &amp; Takayama T&amp;F Festa 2026</a></td>
    <td><span class="hidden">2026-08-02 08:00:00</span>Aug 2, 2026</td>
    <td>64</td><td>50</td>
  </tr>
</tbody></table><!-- ${origin} -->`;
}

const HUB = `<table class="table table-hover"><tbody>
  <tr>
    <td><a href="/results/?p=view_race_result&id=7055577" class="block"><i class="fa fa-trophy"></i> Race 13: EP-T STOCK A3-Main</a></td>
    <td>Sep 13, 2026 at 11:47am</td>
  </tr>
  <tr>
    <td><a href="/results/?p=view_race_result&id=7055575" class="block"><i class="fa fa-trophy"></i> Race 1: EP-T STOCK A1-Main</a></td>
    <td>Sep 13, 2026 at 1:19pm</td>
  </tr>
  <tr>
    <td><a href="/results/?p=view_race_result&id=7055001" class="block"><i class="fa fa-trophy"></i> Race 4: EP-T STOCK Heat 2</a></td>
    <td>Sep 12, 2026</td>
  </tr>
</tbody></table>`;

test("the meeting is read off the race page's breadcrumb", () => {
  assert.deepEqual(extractLiveRcRaceMeeting(racePage({ meeting: JMRCA, calendar: "Sep 12, 2026 to Sep 13, 2026" })), {
    name: JMRCA,
    firstYmd: "2026-09-12",
    lastYmd: "2026-09-13",
  });
  assert.deepEqual(extractLiveRcRaceMeeting(racePage({ meeting: "1/10th Offroad Nats 2026", calendar: "Sep 20, 2026" })), {
    name: "1/10th Offroad Nats 2026",
    firstYmd: "2026-09-20",
    lastYmd: "2026-09-20",
  });
});

test("the meeting of the same name on the page's dates is looked in first", () => {
  const events = parseLiveRcEventListHtml(eventsPage("x"), "https://teamjoybox.liverc.com/events/");
  const hubs = liveRcHubsForRaceMeeting(events, {
    name: JMRCA,
    firstYmd: "2026-09-12",
    lastYmd: "2026-09-13",
  });
  assert.equal(hubs[0], "https://teamjoybox.liverc.com/results/?p=view_event&id=517813");
  assert.ok(!hubs.includes("https://teamjoybox.liverc.com/results/?p=view_event&id=513424"), "August is not on these dates");

  // A club that reuses a name every week: only the one on the page's dates.
  const weekly = [
    { eventHubUrl: "https://c.liverc.com/results/?p=view_event&id=2", eventId: "2", name: "Club Day", startYmd: "2026-09-20", endYmd: "2026-09-20" },
    { eventHubUrl: "https://c.liverc.com/results/?p=view_event&id=1", eventId: "1", name: "Club Day", startYmd: "2026-09-13", endYmd: "2026-09-13" },
  ];
  assert.deepEqual(liveRcHubsForRaceMeeting(weekly, { name: "club  day", firstYmd: "2026-09-13", lastYmd: "2026-09-13" })[0], weekly[1]!.eventHubUrl);
});

test("the race's own time is read off the meeting's list, and a bare date is not a time", () => {
  const hubUrl = "https://teamjoybox.liverc.com/results/?p=view_event&id=517813";
  assert.equal(listedTimeOfLiveRcRace(HUB, hubUrl, "7055575"), "2026-09-13T13:19:00.000Z");
  assert.equal(listedTimeOfLiveRcRace(HUB, hubUrl, "7055577"), "2026-09-13T11:47:00.000Z");
  assert.equal(listedTimeOfLiveRcRace(HUB, hubUrl, "7055001"), null, "listed with no clock");
  assert.equal(listedTimeOfLiveRcRace(HUB, hubUrl, "9999999"), null, "not on this meeting");
});

/**
 * West Coast Model RC's Spring Cup (13 Sept 2026), its race list cut to one class, as fetched on
 * 2026-09-26: LiveRC heads each round with its own row and starts every round at Race 1 again.
 */
const ROUNDS_HUB = `<table class="table table-hover entry_list_data">
<thead><tr><th colspan="2"><span class="class_header">Race Results</span></th></tr></thead>
<tbody>
<tr><th>Main Events</th><th>Time Completed</th></tr>
<tr>
  <td><a href="/results/?p=view_race_result&id=7055964" class="block"><i class="fa fa-trophy"></i> Race 11: ISTC - 21.5T A3-Main</a></td>
  <td>Sep 13, 2026 at 4:16pm</td>
</tr>
<tr><th>Qualifier Round 3</th><th>Time Completed</th></tr>
<tr>
  <td><a href="/results/?p=view_race_result&id=7055728" class="block"><i class="fa fa-trophy"></i> Race 4: ISTC - 21.5T  (Heat 2/2)</a></td>
  <td>Sep 13, 2026 at 1:06pm</td>
</tr>
<tr><th>Qualifier Round 2</th><th>Time Completed</th></tr>
<tr>
  <td><a href="/results/?p=view_race_result&id=7055607" class="block"><i class="fa fa-trophy"></i> Race 4: ISTC - 21.5T  (Heat 2/2)</a></td>
  <td>Sep 13, 2026 at 12:04pm</td>
</tr>
<tr><th>Qualifier Round 1</th><th>Time Completed</th></tr>
<tr>
  <td><a href="/results/?p=view_race_result&id=7054994" class="block"><i class="fa fa-trophy"></i> Race 4: ISTC - 21.5T  (Heat 2/2)</a></td>
  <td>Sep 13, 2026 at 11:03am</td>
</tr>
</tbody></table>`;

test("each race on a meeting's list knows the round it is listed under", () => {
  const rows = extractRaceSessions(ROUNDS_HUB, "https://westcoast.liverc.com/results/?p=view_event&id=518166");
  assert.deepEqual(
    rows.map((r) => [r.sessionId, r.roundName, r.listLinkText]),
    [
      ["7055964", "Main Events", "Race 11: ISTC - 21.5T A3-Main"],
      ["7055728", "Qualifier Round 3", "Race 4: ISTC - 21.5T (Heat 2/2)"],
      ["7055607", "Qualifier Round 2", "Race 4: ISTC - 21.5T (Heat 2/2)"],
      ["7054994", "Qualifier Round 1", "Race 4: ISTC - 21.5T (Heat 2/2)"],
    ]
  );
  // The three qualifiers the picker listed as one title three times now read apart.
  assert.deepEqual(
    rows.slice(1).map((r) => withLiveRcRound(r.listLinkText!, r.roundName)),
    [
      "Qualifier 3 · Race 4: ISTC - 21.5T (Heat 2/2)",
      "Qualifier 2 · Race 4: ISTC - 21.5T (Heat 2/2)",
      "Qualifier 1 · Race 4: ISTC - 21.5T (Heat 2/2)",
    ]
  );
});

test("a race list with no round headings has no round", () => {
  const rows = extractRaceSessions(HUB, "https://teamjoybox.liverc.com/results/?p=view_event&id=517813");
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.roundName === null));
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serve LiveRC from memory: path+query → page; anything else 404s. */
function stubLiveRc(origin: string, pages: Record<string, string>): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const u = new URL(url);
    const body = u.origin === origin ? pages[`${u.pathname}${u.search}`] : undefined;
    const res =
      body == null
        ? new Response("not found", { status: 404 })
        : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    // A real response carries the address it came from; links on the page resolve against it.
    Object.defineProperty(res, "url", { value: url });
    return res;
  }) as typeof fetch;
  return asked;
}

test("a pasted race from day two of a meeting lands on its own day and time", async () => {
  // Each test its own club: the events page and the pages are held in memory between reads.
  const origin = "https://joybox-a.liverc.com";
  stubLiveRc(origin, {
    "/results/?p=view_race_result&id=7055575": racePage({ meeting: JMRCA, calendar: "Sep 12, 2026 to Sep 13, 2026" }),
    "/events/": eventsPage(origin),
    "/results/?p=view_event&id=517813": HUB,
  });

  const parsed = await importLiveRcRaceResult(`${origin}/results/?p=view_race_result&id=7055575`);

  assert.equal(parsed.sessionCompletedAtIso, "2026-09-13T13:19:00.000Z", "Sunday 1:19 pm, not Saturday 12:00 am");
  assert.equal(parsed.sessionDrivers?.length, 2);
  assert.equal(parsed.sessionHint?.className, "EP-T STOCK A1-Main");
});

test("when the meeting's list can't be read, the page's date stands with no clock", async () => {
  const origin = "https://joybox-b.liverc.com";
  stubLiveRc(origin, {
    "/results/?p=view_race_result&id=7055575": racePage({ meeting: JMRCA, calendar: "Sep 12, 2026 to Sep 13, 2026" }),
    // No events page, no meeting page, no front page.
  });

  const parsed = await importLiveRcRaceResult(`${origin}/results/?p=view_race_result&id=7055575`);

  assert.equal(parsed.sessionCompletedAtIso, "2026-09-12T00:00:00.000Z");
  assert.equal(
    isDateOnlyTrackTime({ iso: parsed.sessionCompletedAtIso, parserId: parsed.parserId, sourceUrl: `${origin}/results/` }),
    true,
    "stored as the day with the time unknown, which every reader prints as a date"
  );
  assert.ok(parsed.laps.length > 0, "the laps still import");
});

test("a page that prints its own clock is not looked up", async () => {
  const origin = "https://joybox-c.liverc.com";
  const page = racePage({ meeting: JMRCA, calendar: "Sep 13, 2026" }).replace(
    "EP-T STOCK A1-Main :: LiveRC",
    "EP-T STOCK A1-Main on Sunday, 13 September 2026 at 1:19 PM :: LiveRC"
  );
  const asked = stubLiveRc(origin, { "/results/?p=view_race_result&id=7055575": page });

  const parsed = await importLiveRcRaceResult(`${origin}/results/?p=view_race_result&id=7055575`);

  assert.equal(parsed.sessionCompletedAtIso, "2026-09-13T13:19:00.000Z");
  assert.equal(asked.length, 1, "only the race page");
});
