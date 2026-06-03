/**
 * Run: `npx tsx src/lib/lapWatch/resolveEventFromLiveRcMeeting.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLiveRcMeetingDetectionPayload,
  defaultEventNameFromLiveRcLabel,
  defaultEventDatesForLiveRcDetection,
  localTodayYmd,
  normalizeLiveRcEventHubUrl,
} from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";

test("normalizeLiveRcEventHubUrl canonicalizes view_event query", () => {
  const a = normalizeLiveRcEventHubUrl(
    "https://tftr.liverc.com/?p=view_event&id=123&foo=bar#section"
  );
  const b = normalizeLiveRcEventHubUrl("https://tftr.liverc.com/?p=view_event&id=123");
  assert.equal(a, b);
  assert.ok(a?.includes("p=view_event"));
});

test("defaultEventDatesForLiveRcDetection uses local today", () => {
  const ref = new Date(2026, 5, 3, 15, 30, 0);
  const { startYmd, endYmd } = defaultEventDatesForLiveRcDetection(ref);
  assert.equal(startYmd, localTodayYmd(ref));
  assert.equal(endYmd, startYmd);
});

test("defaultEventNameFromLiveRcLabel falls back sensibly", () => {
  assert.equal(defaultEventNameFromLiveRcLabel("Summer Champs"), "Summer Champs");
  assert.equal(
    defaultEventNameFromLiveRcLabel("View Current Event", "HobbyTown"),
    "HobbyTown race meeting"
  );
});

test("buildLiveRcMeetingDetectionPayload returns canonical fields", () => {
  const payload = buildLiveRcMeetingDetectionPayload({
    eventLabel: "Club Challenge",
    eventHubUrl: "https://tftr.liverc.com/?p=view_event&id=99",
    trackLiveRcUrl: "https://tftr.liverc.com/",
    matchedEventId: "ev1",
  });
  assert.ok(payload);
  assert.equal(payload!.eventLabel, "Club Challenge");
  assert.equal(payload!.matchedEventId, "ev1");
});
