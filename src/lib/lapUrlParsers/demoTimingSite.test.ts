import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  DEMO_TIMING_HOST,
  DEMO_TIMING_ORIGIN,
  isDemoTimingSiteEnabled,
  serveDemoTimingPage,
} from "./demoTimingSite";

/**
 * The demo timing site fabricates race results. These tests are the guard on the two ways
 * that could reach someone it is not meant for: switched on in production, or answering for
 * a host that isn't the invented one.
 */

test("production refuses the demo site even with the flag set", () => {
  assert.equal(isDemoTimingSiteEnabled({ NODE_ENV: "production", DEMO_TIMING_SITE: "1" }), false);
});

test("the flag is required — a dev box without it gets the real internet", () => {
  assert.equal(isDemoTimingSiteEnabled({ NODE_ENV: "development" }), false);
  assert.equal(isDemoTimingSiteEnabled({ NODE_ENV: "development", DEMO_TIMING_SITE: "0" }), false);
  assert.equal(isDemoTimingSiteEnabled({ NODE_ENV: "development", DEMO_TIMING_SITE: "1" }), true);
});

test("only the invented host is answered — real timing sites still go to the network", () => {
  for (const url of [
    "https://tftr.liverc.com/results/?p=view_race_result&id=1",
    "https://speedhive.mylaps.com/sessions/1",
    "https://www.myrcm.ch/sportsmanager/index.php",
    "https://ironbark.liverc.com.evil.example/",
    "not a url",
  ]) {
    assert.equal(serveDemoTimingPage(url), null, `should not answer ${url}`);
  }
});

test("the pages the discovery scan asks for are all served", () => {
  const urls = [
    `${DEMO_TIMING_ORIGIN}/`,
    `${DEMO_TIMING_ORIGIN}/practice/`,
    `${DEMO_TIMING_ORIGIN}/practice/?ym=2026-07`,
    `${DEMO_TIMING_ORIGIN}/results/`,
    `${DEMO_TIMING_ORIGIN}/results/?p=view_event&id=90210`,
    `${DEMO_TIMING_ORIGIN}/results/?p=view_race_result&id=512044`,
  ];
  for (const url of urls) {
    const page = serveDemoTimingPage(url);
    assert.ok(page, `no page for ${url}`);
    assert.match(page.contentType, /text\/html/);
    assert.ok(page.text.length > 100, `page too short for ${url}`);
  }
});

test("an unknown race id is a miss, not an invented race", () => {
  assert.equal(serveDemoTimingPage(`${DEMO_TIMING_ORIGIN}/results/?p=view_race_result&id=999999`), null);
});

test("session times track the clock, so the picker always reads as today", () => {
  const morning = new Date("2026-08-18T09:15:00");
  const evening = new Date("2026-08-18T19:15:00");
  const hub = (now: Date) =>
    serveDemoTimingPage(`${DEMO_TIMING_ORIGIN}/results/?p=view_event&id=90210`, now)!.text;
  assert.notEqual(hub(morning), hub(evening));
  assert.match(hub(morning), /Aug 18, 2026 at/);
});

test("lap times are stable across calls — a re-shoot matches the take before it", () => {
  const url = `${DEMO_TIMING_ORIGIN}/results/?p=view_race_result&id=512044`;
  const a = serveDemoTimingPage(url, new Date("2026-08-18T14:00:00"))!.text;
  const b = serveDemoTimingPage(url, new Date("2026-08-18T14:00:00"))!.text;
  assert.equal(a, b);
});

test("the demo host is not a real timing domain anyone could own", () => {
  // liverc.com subdomains are handed out by LiveRC, so this is only ever reached in-process.
  assert.match(DEMO_TIMING_HOST, /^[a-z]+\.liverc\.com$/);
});
