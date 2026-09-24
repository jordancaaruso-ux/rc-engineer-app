/**
 * Run: `npm run test:fetch-text`
 *
 * Locks the timing-site politeness in `fetchText.ts` (2026-09-24 launch audit). The stakes: every
 * read leaves from the same few server addresses, so a site that blocks us blocks every driver's
 * lap import at once. These prove we share what we already fetched and back off when told to.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUrlText, looksLikeBotCheck, sharedPageSeconds } from "@/lib/lapUrlParsers/fetchText";

test("posted results are shared for an hour, lists for half a minute", () => {
  assert.equal(sharedPageSeconds("https://x.liverc.com/results/?p=view_race_result&id=123"), 3600);
  assert.equal(sharedPageSeconds("https://x.liverc.com/results/?p=view_driver_laps&id=5"), 3600);
  assert.equal(sharedPageSeconds("https://x.liverc.com/practice/?p=view_session&id=77"), 600);
  assert.equal(sharedPageSeconds("https://x.liverc.com/results/?p=view_event&id=9"), 30);
  assert.equal(sharedPageSeconds("https://x.liverc.com/practice/?p=session_list&d=2026-09-20"), 30);
});

test("a bot-check page is recognised, a real page is not", () => {
  assert.equal(looksLikeBotCheck("<html><head><title>Just a moment...</title>"), true);
  assert.equal(looksLikeBotCheck('<div id="challenge-platform"></div>'), true);
  assert.equal(looksLikeBotCheck("<html><head><title>Race Results</title></head>"), false);
});

test("shares pages, and leaves a site alone after it says slow down", async () => {
  let calls = 0;
  let status = 200;
  let body = "<html>ok</html>";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return new Response(body, {
      status,
      headers: status === 429 ? { "retry-after": "90" } : {},
    });
  }) as typeof fetch;
  try {
    const result = "https://one.liverc.example/results/?p=view_race_result&id=1";
    const [a, b] = await Promise.all([fetchUrlText(result), fetchUrlText(result)]);
    assert.equal(calls, 1, "two drivers asking at once cause one read");
    assert.ok(a.ok && b.ok);
    await fetchUrlText(result);
    assert.equal(calls, 1, "a posted result is served from memory");

    status = 429;
    const limited = await fetchUrlText("https://one.liverc.example/results/?p=view_event&id=2");
    assert.equal(limited.ok, false);
    assert.equal(calls, 2);
    const paused = await fetchUrlText("https://one.liverc.example/results/?p=view_event&id=3");
    assert.equal(paused.ok, false);
    assert.equal(calls, 2, "a site that asked us to slow down is not asked again yet");

    status = 200;
    body = "<html><head><title>Just a moment...</title></head></html>";
    const challenged = await fetchUrlText("https://two.liverc.example/results/?p=view_event&id=4");
    assert.equal(challenged.ok, false, "a bot check never parses as 'nothing posted'");
    assert.equal(calls, 3);
    await fetchUrlText("https://two.liverc.example/results/?p=view_event&id=5");
    assert.equal(calls, 3, "and that site is left alone too");

    body = "<html>ok</html>";
    const other = await fetchUrlText("https://three.example/results");
    assert.ok(other.ok, "other sites are unaffected");
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});
