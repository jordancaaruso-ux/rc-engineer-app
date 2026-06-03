/**
 * Run: `npx tsx src/lib/location/trackProximity.test.ts`
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findTracksNearPosition,
  haversineMeters,
  pickTrackFromPosition,
  sortNearbyTracks,
  DEFAULT_TRACK_PROXIMITY_RADIUS_M,
} from "@/lib/location/trackProximity";

test("haversineMeters is zero for same point", () => {
  assert.equal(haversineMeters({ latitude: 51.5, longitude: -0.1 }, { latitude: 51.5, longitude: -0.1 }), 0);
});

test("findTracksNearPosition returns only tracks within radius sorted by distance", () => {
  const tracks = [
    { id: "a", name: "Near", latitude: 51.5, longitude: -0.1 },
    { id: "b", name: "Far", latitude: 52.5, longitude: -0.1 },
    { id: "c", name: "Unmarked", latitude: null, longitude: null },
  ];
  const near = findTracksNearPosition(tracks, { latitude: 51.5001, longitude: -0.1001 }, 500);
  assert.equal(near.length, 1);
  assert.equal(near[0]?.track.id, "a");
  assert.ok((near[0]?.distanceM ?? 999) < 500);
});

test("findTracksNearPosition can return multiple tracks", () => {
  const tracks = [
    { id: "a", name: "A", latitude: 51.5, longitude: -0.1 },
    { id: "b", name: "B", latitude: 51.5002, longitude: -0.1002 },
  ];
  const near = findTracksNearPosition(tracks, { latitude: 51.5, longitude: -0.1 }, DEFAULT_TRACK_PROXIMITY_RADIUS_M);
  assert.equal(near.length, 2);
  assert.ok(near[0]!.distanceM <= near[1]!.distanceM);
});

test("sortNearbyTracks lists favourites before others at similar distance", () => {
  const nearby = [
    { track: { id: "far-fav", name: "Fav", latitude: 51.5003, longitude: -0.1 }, distanceM: 30 },
    { track: { id: "near", name: "Near", latitude: 51.5, longitude: -0.1 }, distanceM: 10 },
  ];
  const sorted = sortNearbyTracks(nearby, ["far-fav"]);
  assert.equal(sorted[0]?.track.id, "far-fav");
});

test("pickTrackFromPosition auto-selects only when one track in range", () => {
  const tracks = [{ id: "only", name: "Only", latitude: 51.5, longitude: -0.1 }];
  const pick = pickTrackFromPosition(tracks, { latitude: 51.5001, longitude: -0.1001 });
  assert.equal(pick.kind, "single");
  if (pick.kind === "single") assert.equal(pick.track.id, "only");
});

test("pickTrackFromPosition returns multiple when ambiguous", () => {
  const tracks = [
    { id: "a", name: "A", latitude: 51.5, longitude: -0.1 },
    { id: "b", name: "B", latitude: 51.5002, longitude: -0.1002 },
  ];
  const pick = pickTrackFromPosition(tracks, { latitude: 51.5, longitude: -0.1 });
  assert.equal(pick.kind, "multiple");
});

test("pickTrackFromPosition reports no marked tracks", () => {
  const pick = pickTrackFromPosition(
    [{ id: "x", name: "X", latitude: null, longitude: null }],
    { latitude: 0, longitude: 0 }
  );
  assert.equal(pick.kind, "no_marked_tracks");
});
