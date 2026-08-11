/**
 * Run: `npm run test:track-timing-url`
 *
 * Guards the single "Timing page" box that both track-creation surfaces now use — the
 * inline "New track" row mid-run and the Tracks page add form. The driver pastes one
 * address and never picks a provider, so the sorting has to be right: a wrong guess
 * writes the URL into the column lap discovery doesn't read, and the track silently
 * searches nothing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyTrackTimingUrl } from "@/lib/tracks/trackTimingUrl";

test("a LiveRC track host files under liveRcUrl, normalized to its origin", () => {
  const got = classifyTrackTimingUrl("https://tftr.liverc.com/results/?p=view_race_results");
  assert.equal(got.ok, true);
  assert.equal(got.ok && got.field, "liveRcUrl");
  assert.equal(got.ok && got.url, "https://tftr.liverc.com");
});

test("a Speedhive practice page files under speedhiveUrl", () => {
  const got = classifyTrackTimingUrl("https://speedhive.mylaps.com/practice/4591");
  assert.equal(got.ok, true);
  assert.equal(got.ok && got.field, "speedhiveUrl");
  assert.equal(got.ok && got.url, "https://speedhive.mylaps.com/practice/4591");
});

test("a bare host with no scheme still classifies — drivers paste what they read", () => {
  const got = classifyTrackTimingUrl("tftr.liverc.com");
  assert.equal(got.ok, true);
  assert.equal(got.ok && got.field, "liveRcUrl");
  assert.equal(got.ok && got.url, "https://tftr.liverc.com");
});

test("surrounding whitespace is trimmed before classifying", () => {
  const got = classifyTrackTimingUrl("  https://tftr.liverc.com  ");
  assert.equal(got.ok, true);
  assert.equal(got.ok && got.field, "liveRcUrl");
});

test("a non-timing address is rejected and names both providers", () => {
  const got = classifyTrackTimingUrl("https://example.com/results");
  assert.equal(got.ok, false);
  assert.match(got.ok ? "" : got.error, /LiveRC or Speedhive/i);
});

test("right provider, wrong page keeps that provider's own error", () => {
  const got = classifyTrackTimingUrl("https://speedhive.mylaps.com/about");
  assert.equal(got.ok, false);
  assert.match(got.ok ? "" : got.error, /practice|organization/i);
});

test("an empty box asks for the timing page rather than throwing", () => {
  const got = classifyTrackTimingUrl("   ");
  assert.equal(got.ok, false);
  assert.match(got.ok ? "" : got.error, /timing page/i);
});
