/**
 * Run: `npx tsx src/lib/runs/buildRunHistoryGroups.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDayRunNameMap,
  buildRunHistoryGroups,
  meetingIdByRunId,
  resolveSessionGroupKeys,
  sessionGroupKey,
} from "@/lib/runs/buildRunHistoryGroups";
import { formatRunSessionDisplay } from "@/lib/runSession";

test("buildRunHistoryGroups groups by event and orders newest first", () => {
  const runs = [
    {
      id: "r1",
      createdAt: new Date("2025-03-01T10:00:00Z"),
      sortAt: new Date("2025-03-01T10:00:00Z"),
      eventId: "e1",
      trackNameSnapshot: null,
      event: {
        name: "Spring Meet",
        startDate: new Date("2025-03-01"),
        endDate: new Date("2025-03-01"),
        track: { name: "TFTR" },
      },
    },
    {
      id: "r2",
      createdAt: new Date("2025-02-01T10:00:00Z"),
      sortAt: new Date("2025-02-01T10:00:00Z"),
      eventId: null,
      trackNameSnapshot: "Home",
      track: { name: "Home" },
      event: null,
    },
  ];
  const groups = buildRunHistoryGroups(runs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.id, "event-e1");
  assert.equal(groups[0]!.type, "Event");
  assert.equal(groups[1]!.type, "Testing");
});

test("buildRunHistoryGroups splits same-day non-event runs by track", () => {
  const day = "2025-04-05T09:00:00Z";
  const runs = [
    {
      id: "geelong-1",
      createdAt: new Date(day),
      sortAt: new Date(day),
      eventId: null,
      trackId: "t-geelong",
      trackNameSnapshot: "Geelong",
      track: { name: "Geelong" },
      event: null,
    },
    {
      id: "mr33-1",
      createdAt: new Date(day),
      sortAt: new Date("2025-04-05T11:00:00Z"),
      eventId: null,
      trackId: "t-mr33",
      trackNameSnapshot: "MR33 Arena",
      track: { name: "MR33 Arena" },
      event: null,
    },
    {
      id: "geelong-2",
      createdAt: new Date(day),
      sortAt: new Date("2025-04-05T10:00:00Z"),
      eventId: null,
      trackId: "t-geelong",
      trackNameSnapshot: "Geelong",
      track: { name: "Geelong" },
      event: null,
    },
  ];
  const groups = buildRunHistoryGroups(runs);
  // Two tracks on one day → two groups, each labelled with its own track.
  assert.equal(groups.length, 2);
  const byTrack = Object.fromEntries(groups.map((g) => [g.trackName, g.runs.length]));
  assert.equal(byTrack["Geelong"], 2);
  assert.equal(byTrack["MR33 Arena"], 1);
});

test("buildRunHistoryGroups groups by local day, not UTC, when a zone is given", () => {
  // Both instants are 12 Jul in Australia/Melbourne (UTC+10) but straddle the
  // UTC midnight boundary (11 Jul vs 12 Jul UTC).
  const runs = [
    {
      id: "late-night",
      createdAt: new Date("2025-07-11T14:30:00Z"), // 12 Jul 00:30 AEST
      sortAt: new Date("2025-07-11T14:30:00Z"),
      eventId: null,
      trackId: "t1",
      trackNameSnapshot: "TFTR",
      track: { name: "TFTR" },
      event: null,
    },
    {
      id: "next-morning",
      createdAt: new Date("2025-07-12T02:00:00Z"), // 12 Jul 12:00 AEST
      sortAt: new Date("2025-07-12T02:00:00Z"),
      eventId: null,
      trackId: "t1",
      trackNameSnapshot: "TFTR",
      track: { name: "TFTR" },
      event: null,
    },
  ];
  // UTC keying splits them into two groups…
  assert.equal(buildRunHistoryGroups(runs).length, 2);
  // …but the local day keeps them together.
  const local = buildRunHistoryGroups(runs, "Australia/Melbourne");
  assert.equal(local.length, 1);
  assert.equal(local[0]!.runs.length, 2);
});

test("a teammate's test day stays one group, whatever zone the reader is in", () => {
  // Dayne runs 09:12 → 17:02 on 6 Aug at MR33 Arena (UTC+2). Read from Melbourne
  // (UTC+10), his afternoon crosses the reader's midnight — which used to file the
  // last runs under 07 Aug in a group of their own.
  const runs = ["07:12", "11:20", "15:02"].map((hhmm, i) => ({
    id: `dayne-${i + 1}`,
    createdAt: new Date(`2026-08-06T${hhmm}:00Z`),
    sortAt: new Date(`2026-08-06T${hhmm}:00Z`),
    eventId: null,
    userId: "dayne",
    localTimeZone: "Europe/Berlin",
    trackNameSnapshot: "MR33 Arena",
    track: { name: "MR33 Arena" },
    event: null,
  }));

  const readFromMelbourne = buildRunHistoryGroups(runs, "Australia/Melbourne");
  assert.equal(readFromMelbourne.length, 1);
  assert.equal(readFromMelbourne[0]!.runs.length, 3);
  // And the header names the driver's date, not the reader's.
  assert.match(readFromMelbourne[0]!.title, /6 Aug 2026/);

  // Same grouping for every reader — that is the whole point.
  for (const zone of ["Europe/Berlin", "America/New_York", "UTC", null]) {
    assert.equal(buildRunHistoryGroups(runs, zone).length, 1, `reader zone ${zone}`);
  }
});

test("runs without their own zone fall back to the owner's account zone", () => {
  // Logged before Run.localTimeZone existed, so only User.timeZone can say what day
  // these were to the person who drove them.
  const runs = ["07:12", "15:02"].map((hhmm, i) => ({
    id: `legacy-${i + 1}`,
    createdAt: new Date(`2026-08-06T${hhmm}:00Z`),
    sortAt: new Date(`2026-08-06T${hhmm}:00Z`),
    eventId: null,
    userId: "dayne",
    localTimeZone: null,
    trackNameSnapshot: "MR33 Arena",
    track: { name: "MR33 Arena" },
    event: null,
  }));

  // Reader in Melbourne, no owner zone known → splits, as it does today.
  assert.equal(buildRunHistoryGroups(runs, "Australia/Melbourne").length, 2);
  // Owner zone known → one group again.
  const withOwner = buildRunHistoryGroups(runs, "Australia/Melbourne", {
    ownerTimeZoneByUserId: { dayne: "Europe/Berlin" },
  });
  assert.equal(withOwner.length, 1);
  assert.equal(withOwner[0]!.runs.length, 2);
});

const testingRun = (
  id: string,
  iso: string,
  userId: string,
  session: Partial<{
    sessionType: string;
    meetingSessionType: string | null;
    sessionLabel: string | null;
  }> = {}
) => ({
  id,
  createdAt: new Date(iso),
  sortAt: new Date(iso),
  userId,
  sessionType: "TESTING",
  meetingSessionType: null,
  sessionLabel: null,
  ...session,
});

test("buildDayRunNameMap numbers unnamed runs per user per local day, in sortAt order", () => {
  const runs = [
    // Jordan, day 1 — logged out of array order; sortAt decides.
    testingRun("j-2", "2025-07-01T02:00:00Z", "jordan"),
    testingRun("j-1", "2025-07-01T00:30:00Z", "jordan"),
    // Jordan, day 2 — numbering restarts.
    testingRun("j-3", "2025-07-02T01:00:00Z", "jordan"),
    // Teammate, same day 1 — independent numbering.
    testingRun("t-1", "2025-07-01T01:00:00Z", "teammate"),
  ];
  const map = buildDayRunNameMap(runs);
  assert.equal(map["j-1"], "Run 1");
  assert.equal(map["j-2"], "Run 2");
  assert.equal(map["j-3"], "Run 1");
  assert.equal(map["t-1"], "Run 1");
});

test("buildDayRunNameMap: a name the day REPEATS becomes the run's position", () => {
  // The reported bug (2026-08-25): five practice sessions, five runs all named
  // "Practice", so every line pointing at one of them pointed at all of them.
  const practice = (id: string, iso: string) =>
    testingRun(id, iso, "jordan", {
      sessionType: "RACE_MEETING",
      meetingSessionType: "PRACTICE",
    });
  const map = buildDayRunNameMap([
    practice("p-1", "2025-07-01T00:30:00Z"),
    practice("p-2", "2025-07-01T02:00:00Z"),
    practice("p-3", "2025-07-01T04:00:00Z"),
  ]);
  assert.deepEqual([map["p-1"], map["p-2"], map["p-3"]], ["Run 1", "Run 2", "Run 3"]);
});

test("buildDayRunNameMap: names that do NOT repeat are left completely alone", () => {
  const meeting = (id: string, iso: string, meetingSessionType: string) =>
    testingRun(id, iso, "jordan", { sessionType: "RACE_MEETING", meetingSessionType });
  const map = buildDayRunNameMap([
    meeting("m-1", "2025-07-01T00:30:00Z", "PRACTICE"),
    meeting("m-2", "2025-07-01T02:00:00Z", "QUALIFYING"),
    meeting("m-3", "2025-07-01T04:00:00Z", "RACE"),
  ]);
  assert.deepEqual([map["m-1"], map["m-2"], map["m-3"]], ["Practice", "Qualifying", "Race"]);
});

test("buildDayRunNameMap: a repeat is judged inside ONE day, not across the week", () => {
  const practice = (id: string, iso: string) =>
    testingRun(id, iso, "jordan", {
      sessionType: "RACE_MEETING",
      meetingSessionType: "PRACTICE",
    });
  // One practice on each of two days: neither day repeats anything, so both keep the name.
  const map = buildDayRunNameMap([
    practice("d1", "2025-07-01T00:30:00Z"),
    practice("d2", "2025-07-02T00:30:00Z"),
  ]);
  assert.deepEqual([map["d1"], map["d2"]], ["Practice", "Practice"]);
});

test("formatRunSessionDisplay names unlabeled testing runs from dayRunNumber, label still wins", () => {
  const unlabeled = { sessionType: "TESTING", sessionLabel: null };
  assert.equal(formatRunSessionDisplay(unlabeled), "—");
  assert.equal(formatRunSessionDisplay(unlabeled, { dayRunNumber: 2 }), "Run 2");
  assert.equal(formatRunSessionDisplay(unlabeled, { fallback: "Run" }), "Run");
  // A typed label always beats the fallback name.
  assert.equal(
    formatRunSessionDisplay(
      { sessionType: "TESTING", sessionLabel: "Rears softer" },
      { dayRunNumber: 2 }
    ),
    "Rears softer"
  );
  // Meeting runs keep their session naming untouched.
  assert.equal(
    formatRunSessionDisplay(
      { sessionType: "RACE_MEETING", meetingSessionType: "QUALIFYING", sessionLabel: null },
      { dayRunNumber: 4 }
    ),
    "Qualifying"
  );
});

test("sessionGroupKey agrees with the group a run lands in", () => {
  // The workbench counts a session's unfiltered runs from a separate, minimal
  // query and matches them to groups by this key. A minimal row must therefore
  // produce the same key as the full run does — otherwise "2 of 8" counts a
  // different set of runs than the one on screen.
  const full = {
    id: "r1",
    userId: "u1",
    createdAt: new Date("2025-03-01T10:00:00Z"),
    sortAt: new Date("2025-03-01T10:00:00Z"),
    eventId: null,
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Kingston",
    track: { name: "Kingston" },
    event: null,
  };
  const groups = buildRunHistoryGroups([full]);
  assert.equal(sessionGroupKey(full), groups[0]!.id);

  // The count query selects fewer fields — same key, no `event` relation.
  const minimal = {
    id: full.id,
    userId: full.userId,
    createdAt: full.createdAt,
    sortAt: full.sortAt,
    eventId: full.eventId,
    localTimeZone: full.localTimeZone,
    trackNameSnapshot: full.trackNameSnapshot,
    track: full.track,
  };
  assert.equal(sessionGroupKey(minimal), groups[0]!.id);

  // Event runs key on the event alone, and the day/track key never collides with it.
  const eventRun = { ...full, eventId: "e1" };
  assert.equal(sessionGroupKey(eventRun), "event-e1");
  assert.notEqual(sessionGroupKey(eventRun), sessionGroupKey(full));
});

test("sessionGroupKey resolves the day in the driver's zone, not the reader's", () => {
  // 05:00 UTC on 2 Mar is still 21:00 on 1 Mar in Los Angeles. Both sides of the ratio
  // must agree on which day that is, or a session splits between them.
  const run = {
    id: "r1",
    userId: "u1",
    createdAt: new Date("2025-03-02T05:00:00Z"),
    sortAt: new Date("2025-03-02T05:00:00Z"),
    eventId: null,
    localTimeZone: "America/Los_Angeles",
    trackNameSnapshot: "Kingston",
    track: { name: "Kingston" },
  };
  const asDriver = sessionGroupKey(run, { viewerTimeZone: "Australia/Sydney" });
  assert.match(asDriver, /^day-2025-03-01-/);
  // The reader's zone must not move it.
  assert.equal(sessionGroupKey(run, { viewerTimeZone: "UTC" }), asDriver);
  // Falling back to the owner's account zone gives the same answer as the run's own.
  const noRunZone = { ...run, localTimeZone: null };
  assert.equal(
    sessionGroupKey(noRunZone, { ownerTimeZoneByUserId: { u1: "America/Los_Angeles" } }),
    asDriver
  );
});

test("an eventless run at the event's track on an event day folds into the event", () => {
  // Founder ruling 2026-09-06: a teammate who never tapped Join is still at the meeting.
  const sat = "2026-09-05T02:00:00Z"; // Saturday 12:00 in Sydney
  const event = {
    name: "Club Round 4",
    startDate: new Date("2026-09-05T12:00:00Z"),
    endDate: new Date("2026-09-05T12:00:00Z"),
    track: { name: "Ironbark Raceway" },
  };
  const onEvent = {
    id: "mine",
    userId: "u1",
    createdAt: new Date(sat),
    sortAt: new Date(sat),
    eventId: "e1",
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
    event,
  };
  const teammateEventless = {
    id: "theirs",
    userId: "u2",
    createdAt: new Date("2026-09-05T03:00:00Z"),
    sortAt: new Date("2026-09-05T03:00:00Z"),
    eventId: null,
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
    event: null,
  };
  const otherTrackSameDay = {
    ...teammateEventless,
    id: "elsewhere",
    trackNameSnapshot: "Geelong",
    track: { name: "Geelong" },
  };
  // Two days on: a gap day breaks the chain, so this stays its own test day.
  const sameTrackTwoDaysOn = {
    ...teammateEventless,
    id: "monday",
    createdAt: new Date("2026-09-07T03:00:00Z"),
    sortAt: new Date("2026-09-07T03:00:00Z"),
  };
  // The eventless run is listed FIRST so the header must still read off the event run.
  const groups = buildRunHistoryGroups([teammateEventless, onEvent, otherTrackSameDay, sameTrackTwoDaysOn]);
  const ids = groups.map((g) => g.id);
  assert.equal(groups.length, 3, ids.join(", "));
  const meeting = groups.find((g) => g.id === "event-e1")!;
  assert.equal(meeting.type, "Event");
  assert.equal(meeting.title, "Club Round 4");
  assert.deepEqual(meeting.runs.map((r) => r.id).sort(), ["mine", "theirs"]);
  assert.ok(groups.some((g) => g.type === "Testing" && g.runs[0]!.id === "elsewhere"));
  assert.ok(groups.some((g) => g.type === "Testing" && g.runs[0]!.id === "monday"));
});

test("an eventless day touching the meeting folds in, and the chain walks day by day", () => {
  // Founder ruling 2026-09-14: the practice days before a title are part of the weekend.
  const event = {
    name: "State Titles",
    startDate: new Date("2026-09-05T12:00:00Z"), // Sat
    endDate: new Date("2026-09-06T12:00:00Z"), // Sun
    track: { name: "Ironbark Raceway" },
  };
  const base = {
    userId: "u1",
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
  };
  const at = (iso: string) => ({ createdAt: new Date(iso), sortAt: new Date(iso) });
  const sun = { ...base, id: "sun", eventId: "e1", event, ...at("2026-09-06T02:00:00Z") };
  const fri = { ...base, id: "fri", eventId: null, event: null, ...at("2026-09-04T02:00:00Z") };
  const thu = { ...base, id: "thu", eventId: null, event: null, ...at("2026-09-03T02:00:00Z") };
  // Tuesday: Wednesday is empty, so the chain never reaches it.
  const tue = { ...base, id: "tue", eventId: null, event: null, ...at("2026-09-01T02:00:00Z") };
  // Friday at ANOTHER track is somebody else's practice.
  const friElsewhere = {
    ...base,
    id: "fri-geelong",
    eventId: null,
    event: null,
    trackNameSnapshot: "Geelong",
    track: { name: "Geelong" },
    ...at("2026-09-04T04:00:00Z"),
  };
  const groups = buildRunHistoryGroups([sun, fri, thu, tue, friElsewhere]);
  const meeting = groups.find((g) => g.id === "event-e1")!;
  assert.deepEqual(meeting.runs.map((r) => r.id), ["sun", "fri", "thu"]);
  // The meeting's dates span what it actually held, not only what the entry form said.
  assert.match(meeting.dateLabel, /^3 – 6 Sept? 2026$/); // Node spells it "Sept" in en-GB
  assert.ok(groups.some((g) => g.type === "Testing" && g.runs[0]!.id === "tue"));
  assert.ok(groups.some((g) => g.type === "Testing" && g.runs[0]!.id === "fri-geelong"));
  assert.equal(groups.length, 3);
});

test("the fold covers every day the event declares, not only days it has runs on", () => {
  const event = {
    name: "State Titles",
    startDate: new Date("2026-09-04T12:00:00Z"), // Fri
    endDate: new Date("2026-09-06T12:00:00Z"), // Sun
    track: { name: "Ironbark Raceway" },
  };
  const runOnSunday = {
    id: "sun",
    userId: "u1",
    createdAt: new Date("2026-09-06T02:00:00Z"),
    sortAt: new Date("2026-09-06T02:00:00Z"),
    eventId: "e1",
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
    event,
  };
  const practiceFriday = {
    id: "fri",
    userId: "u2",
    createdAt: new Date("2026-09-04T02:00:00Z"),
    sortAt: new Date("2026-09-04T02:00:00Z"),
    eventId: null,
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
    event: null,
  };
  const groups = buildRunHistoryGroups([runOnSunday, practiceFriday]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, "event-e1");
});

test("a run on a different event never folds; the busier event wins a shared day", () => {
  const base = {
    userId: "u1",
    createdAt: new Date("2026-09-05T02:00:00Z"),
    sortAt: new Date("2026-09-05T02:00:00Z"),
    localTimeZone: "Australia/Sydney",
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
  };
  const dates = {
    startDate: new Date("2026-09-05T12:00:00Z"),
    endDate: new Date("2026-09-05T12:00:00Z"),
    track: { name: "Ironbark Raceway" },
  };
  const a1 = { ...base, id: "a1", eventId: "eA", event: { name: "A", ...dates } };
  const b1 = { ...base, id: "b1", userId: "u2", eventId: "eB", event: { name: "B", ...dates } };
  const b2 = { ...base, id: "b2", userId: "u3", eventId: "eB", event: { name: "B", ...dates } };
  const loose = { ...base, id: "loose", userId: "u4", eventId: null, event: null };
  const groups = buildRunHistoryGroups([a1, b1, b2, loose]);
  assert.equal(groups.length, 2);
  const b = groups.find((g) => g.id === "event-eB")!;
  assert.deepEqual(b.runs.map((r) => r.id).sort(), ["b1", "b2", "loose"]);
  assert.deepEqual(groups.find((g) => g.id === "event-eA")!.runs.map((r) => r.id), ["a1"]);
});

test("resolveSessionGroupKeys gives the count query the same folded key as the list", () => {
  const event = {
    name: "Club Round 4",
    startDate: new Date("2026-09-05T12:00:00Z"),
    endDate: new Date("2026-09-05T12:00:00Z"),
    trackNameSnapshot: "Ironbark Raceway",
    track: { name: "Ironbark Raceway" },
  };
  const rows = [
    {
      id: "mine",
      userId: "u1",
      createdAt: new Date("2026-09-05T02:00:00Z"),
      sortAt: new Date("2026-09-05T02:00:00Z"),
      eventId: "e1",
      localTimeZone: "Australia/Sydney",
      trackNameSnapshot: "Ironbark Raceway",
      track: { name: "Ironbark Raceway" },
      event,
    },
    {
      id: "theirs",
      userId: "u2",
      createdAt: new Date("2026-09-05T03:00:00Z"),
      sortAt: new Date("2026-09-05T03:00:00Z"),
      eventId: null,
      localTimeZone: "Australia/Sydney",
      trackNameSnapshot: "Ironbark Raceway",
      track: { name: "Ironbark Raceway" },
      event: null,
    },
  ];
  const keys = resolveSessionGroupKeys(rows);
  const groups = buildRunHistoryGroups(rows);
  assert.equal(keys.get("theirs"), "event-e1");
  assert.equal(keys.get("theirs"), groups[0]!.id);
  // The plain per-run key is unchanged — it is the unfolded answer.
  assert.match(sessionGroupKey(rows[1]!), /^day-2026-09-05-/);
});

test("a meeting's dates are the days it ran, whatever zone the server is in", () => {
  // Found 2026-09-26: on a UTC server (Vercel) a one-day club day with a run before 10am
  // in Brisbane read "25 – 26 Sept 2026", and "26 – 26 Sept 2026" on a Sydney machine.
  const clubDay = {
    name: "Bayside Club Day",
    startDate: new Date("2026-09-26T12:00:00Z"),
    endDate: new Date("2026-09-26T12:00:00Z"),
    track: { name: "Bayside" },
  };
  const titles = {
    name: "State Titles",
    startDate: new Date("2026-09-30T12:00:00Z"),
    endDate: new Date("2026-10-01T12:00:00Z"),
    track: { name: "Bayside" },
  };
  // Older rows store the day at UTC midnight. A real one read "22 – 23 May" live.
  const older = {
    name: "Bayside Clubday",
    startDate: new Date("2026-05-23T00:00:00Z"),
    endDate: new Date("2026-05-23T00:00:00Z"),
    track: { name: "Bayside" },
  };
  // Seeded meetings carry real instants: here Brisbane midnight to the end of the day.
  const seeded = {
    name: "Seeded Club Day",
    startDate: new Date("2026-09-26T14:00:00Z"),
    endDate: new Date("2026-09-27T13:59:59Z"),
    track: { name: "Bayside" },
  };
  const run = (id: string, iso: string, eventId: string, event: typeof clubDay) => ({
    id,
    userId: "u1",
    createdAt: new Date(iso),
    sortAt: new Date(iso),
    eventId,
    localTimeZone: "Australia/Brisbane",
    trackNameSnapshot: "Bayside",
    track: { name: "Bayside" },
    event,
  });
  const runs = [
    run("q2", "2026-09-26T09:35:00+10:00", "club", clubDay),
    run("q3", "2026-09-26T10:20:00+10:00", "club", clubDay),
    run("t1", "2026-09-30T08:10:00+10:00", "titles", titles),
    run("t2", "2026-10-01T15:40:00+10:00", "titles", titles),
    run("o1", "2026-05-23T08:30:00+10:00", "older", older),
    run("s1", "2026-09-27T09:00:00+10:00", "seeded", seeded),
  ];
  // Restored by value: deleting TZ does not put Node back on the machine's zone.
  const machineZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const serverZone of ["UTC", "Australia/Sydney", "America/Los_Angeles"]) {
      process.env.TZ = serverZone;
      const labels = Object.fromEntries(
        buildRunHistoryGroups(runs, "Australia/Brisbane").map((g) => [g.id, g.dateLabel])
      );
      assert.match(labels["event-club"] ?? "", /^26 Sept? 2026$/, serverZone);
      assert.match(labels["event-titles"] ?? "", /^30 Sept? – 1 Oct 2026$/, serverZone);
      assert.equal(labels["event-older"], "23 May 2026", serverZone);
      assert.match(labels["event-seeded"] ?? "", /^27 Sept? 2026$/, serverZone);
    }
  } finally {
    process.env.TZ = machineZone;
  }
});

// W1-07 (test drive 2026-09-26): Henry made "Canowindra Club Day" for today on Events, then logged
// four runs at that track on "Testing" without picking it. Its page said "0 runs linked" and
// Sessions filed the day as "Test day". Approved rule: a run at the same track on a meeting's day
// sits in that meeting, picked or not.

const CANOWINDRA = "Canowindra Model Car Club";
const clubDay = {
  id: "club",
  name: "Canowindra Club Day",
  startDate: new Date("2026-09-26T12:00:00Z"),
  endDate: new Date("2026-09-26T12:00:00Z"),
  trackNameSnapshot: CANOWINDRA,
  track: { name: CANOWINDRA },
};
const henryRun = (id: string, iso: string, track = CANOWINDRA) => ({
  id,
  userId: "henry",
  createdAt: new Date(iso),
  sortAt: new Date(iso),
  eventId: null,
  localTimeZone: "Australia/Sydney",
  trackNameSnapshot: track,
  track: { name: track },
  event: null,
});
const henrysDay = [
  henryRun("h1", "2026-09-26T09:10:00+10:00"),
  henryRun("h2", "2026-09-26T10:05:00+10:00"),
  henryRun("h3", "2026-09-26T11:40:00+10:00"),
  henryRun("h4", "2026-09-26T13:15:00+10:00"),
];

test("a meeting nobody picked for a run still holds the day's runs at its track", () => {
  const groups = buildRunHistoryGroups(henrysDay, "Australia/Sydney", { meetings: [clubDay] });
  assert.equal(groups.length, 1);
  const meeting = groups[0]!;
  assert.equal(meeting.id, "event-club");
  assert.equal(meeting.type, "Event");
  assert.equal(meeting.title, "Canowindra Club Day");
  assert.equal(meeting.trackName, CANOWINDRA);
  assert.match(meeting.dateLabel, /^26 Sept? 2026$/);
  assert.equal(meeting.runs.length, 4);
  // Not told about the meeting, the day is still a test day, as before.
  assert.equal(buildRunHistoryGroups(henrysDay, "Australia/Sydney")[0]!.type, "Testing");
});

test("the count and the list agree on a meeting nobody picked", () => {
  const keys = resolveSessionGroupKeys(henrysDay, { viewerTimeZone: "Australia/Sydney" }, [clubDay]);
  assert.deepEqual([...new Set(keys.values())], ["event-club"]);
});

test("a meeting nobody picked holds nothing at another track or on another day", () => {
  const elsewhere = henryRun("x1", "2026-09-26T10:00:00+10:00", "Orange Raceway");
  const nextDay = henryRun("x2", "2026-09-28T10:00:00+10:00");
  const groups = buildRunHistoryGroups([...henrysDay, elsewhere, nextDay], "Australia/Sydney", {
    meetings: [clubDay],
  });
  assert.deepEqual(
    groups.map((g) => [g.id.startsWith("event-") ? g.id : g.type, g.runs.length]).sort(),
    [
      ["Testing", 1],
      ["Testing", 1],
      ["event-club", 4],
    ]
  );
});

test("a meeting a run was picked for wins the day from one nobody picked", () => {
  const picked = {
    ...henryRun("p1", "2026-09-26T08:30:00+10:00"),
    eventId: "open-day",
    event: {
      name: "Open Day",
      startDate: new Date("2026-09-26T12:00:00Z"),
      endDate: new Date("2026-09-26T12:00:00Z"),
      track: { name: CANOWINDRA },
    },
  };
  const groups = buildRunHistoryGroups([picked, ...henrysDay], "Australia/Sydney", { meetings: [clubDay] });
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, "event-open-day");
  assert.equal(groups[0]!.runs.length, 5);
});

// Re-check of W1-07 (test drive 2026-09-26): the club day's page said 4 runs while the Events list
// showed none, and Ethan's EMCC CUP read 1 in the list and 2 on its page. The list now counts every
// meeting off the same fold at once.

test("every meeting's runs, read at once, are the runs each meeting's page counts", () => {
  const cup = {
    id: "cup",
    name: "EMCC CUP",
    startDate: new Date("2026-09-25T12:00:00Z"),
    endDate: new Date("2026-09-27T12:00:00Z"),
    trackNameSnapshot: "EMCC",
    track: { name: "EMCC" },
  };
  const picked = { ...henryRun("e1", "2026-09-26T10:00:00+10:00", "EMCC"), eventId: "cup", event: cup };
  const leftOnTesting = henryRun("e2", "2026-09-27T09:00:00+10:00", "EMCC");
  const elsewhere = henryRun("x1", "2026-09-26T10:00:00+10:00", "Orange Raceway");
  const byRun = meetingIdByRunId(
    [...henrysDay, picked, leftOnTesting, elsewhere],
    { viewerTimeZone: "Australia/Sydney" },
    [clubDay, cup]
  );
  const counts: Record<string, number> = {};
  for (const id of byRun.values()) counts[id] = (counts[id] ?? 0) + 1;
  assert.deepEqual(counts, { club: 4, cup: 2 });
  assert.equal(byRun.has("x1"), false, "a run in no meeting counts for none");
});
