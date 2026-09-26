import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildTrackEventGroups,
  formatDayRange,
  hubUrlFromOptionValue,
  liveRcOptionValue,
  relativeDayLabel,
  TRACK_EVENTS_STATUS_VALUE,
  type TrackListEvent,
  type TrackListLiveRcMeeting,
} from "@/lib/events/trackEventGroups";

const noon = (ymd: string) => `${ymd}T12:00:00.000Z`;
const HUB = (id: string) => `https://emcc.liverc.com/results/?p=view_event&id=${id}`;

const cup: TrackListLiveRcMeeting = {
  hubUrl: HUB("cup"),
  name: "EMCC CUP 25-27 Sept 2026",
  startYmd: "2026-09-25",
  endYmd: "2026-09-27",
  entries: 43,
  eventId: null,
};
const raceDay: TrackListLiveRcMeeting = {
  hubUrl: HUB("r1110"),
  name: "EMCC Race Day 11/10/2026",
  startYmd: "2026-10-11",
  endYmd: "2026-10-11",
  entries: 0,
  eventId: null,
};

function mine(id: string, name: string, start: string, end = start, extra: Partial<TrackListEvent> = {}): TrackListEvent {
  return { id, name, trackId: "emcc", startDate: noon(start), endDate: noon(end), resultsSourceUrl: null, ...extra };
}

const labels = (groups: ReturnType<typeof buildTrackEventGroups>) =>
  groups.map((g) => [g.label, g.options.map((o) => o.label)]);

test("the day's LiveRC meeting is on today, with its dates, day and entries", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [],
    liveRc: { status: "ok", meetings: [cup] },
  });
  assert.deepEqual(labels(groups), [["On today", ["EMCC CUP 25-27 Sept 2026"]]]);
  const row = groups[0]!.options[0]!;
  assert.equal(row.value, liveRcOptionValue(HUB("cup")));
  assert.equal(row.detail, "Fri 25 – Sun 27 Sep · day 2 of 3 · on LiveRC · 43 entries");
  assert.equal(hubUrlFromOptionValue(row.value), HUB("cup"));
});

test("a race day posted ahead is coming up, and says nobody has entered yet by saying nothing", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-10-05",
    events: [],
    joinable: [],
    liveRc: { status: "ok", meetings: [raceDay] },
  });
  assert.deepEqual(labels(groups), [
    ["On today", ["Nothing on LiveRC here today yet"]],
    ["Coming up", ["EMCC Race Day 11/10/2026"]],
  ]);
  assert.equal(groups[1]!.options[0]!.detail, "Sun 11 Oct · in 6 days · on LiveRC");
});

test("race morning before LiveRC has it: a grey line says so, and it can't be picked", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [],
    liveRc: { status: "ok", meetings: [] },
  });
  const status = groups[0]!.options[0]!;
  assert.equal(status.value, TRACK_EVENTS_STATUS_VALUE.nothingToday);
  assert.equal(status.disabled, true);
});

test("while LiveRC is being read, and when it can't be, the list says so", () => {
  const loading = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [],
    liveRc: { status: "loading", meetings: [] },
  });
  assert.equal(loading[0]!.options[0]!.label, "Checking LiveRC…");
  const down = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [],
    liveRc: { status: "unavailable", meetings: [] },
  });
  assert.equal(down[0]!.options[0]!.label, "Couldn’t reach LiveRC just now");
});

test("a track with no LiveRC page shows no LiveRC line at all", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [mine("ev1", "Club night", "2026-09-26")],
    joinable: [],
    liveRc: { status: "none", meetings: [] },
  });
  assert.deepEqual(labels(groups), [["On today", ["Club night"]]]);
});

test("a meeting the driver already has shows once, as theirs", () => {
  const linked = mine("ev-cup", "EMCC CUP 25-27 Sept 2026", "2026-09-25", "2026-09-27", {
    resultsSourceUrl: HUB("cup"),
  });
  const byLink = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [linked],
    joinable: [],
    liveRc: { status: "ok", meetings: [cup] },
  });
  assert.deepEqual(labels(byLink), [["On today", ["EMCC CUP 25-27 Sept 2026"]]]);
  assert.equal(byLink[0]!.options[0]!.value, "ev-cup");
  assert.match(byLink[0]!.options[0]!.detail ?? "", /on LiveRC$/);

  // Same meeting, known by the row it created rather than the link text.
  const byRow = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [mine("ev-cup", "EMCC Cup", "2026-09-25", "2026-09-27")],
    joinable: [],
    liveRc: { status: "ok", meetings: [{ ...cup, eventId: "ev-cup" }] },
  });
  assert.deepEqual(labels(byRow), [["On today", ["EMCC Cup"]]]);
});

test("a teammate's event is in its day's group, named as theirs", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [
      { id: "team-1", name: "Club day 26/9", startDate: noon("2026-09-26"), endDate: noon("2026-09-26"), ownerName: "Chris" },
    ],
    liveRc: { status: "none", meetings: [] },
  });
  assert.deepEqual(labels(groups), [["On today", ["Club day 26/9"]]]);
  assert.equal(groups[0]!.options[0]!.detail, "Sat 26 Sep · on today · Chris’s event");
});

test("a teammate's event that IS the LiveRC meeting shows once, as the team's", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [
      { id: "team-cup", name: "EMCC Cup", startDate: noon("2026-09-25"), endDate: noon("2026-09-27"), ownerName: "Chris" },
    ],
    liveRc: { status: "ok", meetings: [{ ...cup, eventId: "team-cup" }] },
  });
  assert.deepEqual(labels(groups), [["On today", ["EMCC Cup"]]]);
  assert.equal(groups[0]!.options[0]!.value, "team-cup");
  assert.match(groups[0]!.options[0]!.detail ?? "", /Chris’s event · on LiveRC$/);
});

test("only this track's events, in On today / Coming up / Later / Earlier here, newest past first", () => {
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [
      mine("past-old", "Race Day 23/8", "2026-08-23"),
      mine("past-new", "Race Day 13/9", "2026-09-13"),
      mine("soon", "Practice day", "2026-09-30"),
      mine("later", "Club champs final", "2026-11-22"),
      { ...mine("elsewhere", "Geelong Cup", "2026-09-26"), trackId: "geelong" },
    ],
    joinable: [],
    liveRc: { status: "none", meetings: [] },
  });
  assert.deepEqual(labels(groups), [
    ["Coming up", ["Practice day"]],
    ["Later", ["Club champs final"]],
    ["Earlier here", ["Race Day 13/9", "Race Day 23/8"]],
  ]);
});

test("a LiveRC placeholder spanning years is never on today, and a meeting from Thursday is earlier here", () => {
  // Indoor Raceway, Saturday 26 Sep 2026 (test drive W3-04).
  const template: TrackListLiveRcMeeting = {
    hubUrl: HUB("template"),
    name: "Template Event Copy Only Do Not Use",
    startYmd: "2022-01-11",
    endYmd: "2030-01-11",
    entries: null,
    eventId: null,
  };
  const thursday: TrackListLiveRcMeeting = {
    hubUrl: HUB("222"),
    name: "Indoor Raceway - On Road Event 222",
    startYmd: "2026-09-24",
    endYmd: "2026-09-24",
    entries: 37,
    eventId: null,
  };
  const groups = buildTrackEventGroups({
    trackId: "emcc",
    todayYmd: "2026-09-26",
    events: [],
    joinable: [],
    liveRc: { status: "ok", meetings: [template, thursday] },
  });
  assert.deepEqual(labels(groups), [
    ["On today", ["Nothing on LiveRC here today yet"]],
    ["Earlier here", ["Indoor Raceway - On Road Event 222"]],
  ]);
  assert.equal(groups[1]!.options[0]!.detail, "Thu 24 Sep · 2 days ago · on LiveRC · 37 entries");
  assert.equal(groups[1]!.options[0]!.value, liveRcOptionValue(HUB("222")));
});

test("labels for the dates and the day", () => {
  assert.equal(formatDayRange("2026-09-26", "2026-09-26"), "Sat 26 Sep");
  assert.equal(formatDayRange("2026-10-30", "2026-11-01"), "Fri 30 Oct – Sun 1 Nov");
  // Across a new year both halves say which (W3-04 printed "Tue 11 Jan – Fri 11 Jan").
  assert.equal(formatDayRange("2026-12-31", "2027-01-01"), "Thu 31 Dec 2026 – Fri 1 Jan 2027");
  assert.equal(formatDayRange("2022-01-11", "2030-01-11"), "Tue 11 Jan 2022 – Fri 11 Jan 2030");
  assert.equal(relativeDayLabel("2026-09-26", "2026-09-26", "2026-09-26"), "on today");
  assert.equal(relativeDayLabel("2026-09-27", "2026-09-27", "2026-09-26"), "tomorrow");
  assert.equal(relativeDayLabel("2026-09-13", "2026-09-13", "2026-09-26"), "13 days ago");
  assert.equal(relativeDayLabel("2026-08-23", "2026-08-23", "2026-09-26"), "5 weeks ago");
  assert.equal(relativeDayLabel("2026-09-25", "2026-09-25", "2026-09-26"), "yesterday");
});
