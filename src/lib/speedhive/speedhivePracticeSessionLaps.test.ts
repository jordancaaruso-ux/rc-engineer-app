/**
 * Run: `node --conditions=react-server --import tsx --test src/lib/speedhive/speedhivePracticeSessionLaps.test.ts`
 *
 * (`react-server`: the importer is `server-only`.) The practice API is stubbed with its real
 * answers for one session, Sanne's at ERCE Racing Eindhoven on 24 Sept 2026, cut to the fields read.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  importSpeedhivePracticeActivity,
  isSpeedhivePracticeImportUrl,
} from "./speedhivePracticeSessionLaps";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SESSIONS = {
  sessions: [
    {
      id: 1,
      dateTimeStart: "2026-09-24T19:35:20.808+02:00",
      laps: [
        { nr: 1, dateTimeStart: "2026-09-24T19:35:20.808+02:00", duration: "23.456" },
        { nr: 2, dateTimeStart: "2026-09-24T19:35:44.264+02:00", duration: "23.157" },
      ],
    },
  ],
};

const ACTIVITY = {
  id: 8354099722,
  chipCode: "6611917",
  chipLabel: "Mr.Nice",
  location: { id: 3472, name: "ERCE Racing Eindhoven" },
};

function stubPracticeApi(): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    asked.push(url);
    const path = new URL(url).pathname;
    if (path === "/api/v1/training/activities/8354099722/sessions") return Response.json(SESSIONS);
    if (path === "/api/v1/training/activities/8354099722") return Response.json(ACTIVITY);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return asked;
}

test("the link Speedhive gives out imports, filed under the address URL Auto uses", async () => {
  const asked = stubPracticeApi();
  const url = "https://speedhive.mylaps.com/practice/8354099722/activity";
  assert.equal(isSpeedhivePracticeImportUrl(url), true);

  const parsed = await importSpeedhivePracticeActivity(url);

  assert.deepEqual(parsed.laps, [23.456, 23.157]);
  assert.equal(parsed.errorCode, undefined);
  assert.equal(parsed.sessionCompletedAtIso, "2026-09-24T17:35:20.808Z");
  assert.equal(parsed.sessionUtcOffsetMinutes, 120);
  assert.equal(parsed.sessionHint?.practiceLocationName, "ERCE Racing Eindhoven");
  // The practice API said which track the visit was at, so the paste and the in-app search meet
  // on one address — the one the checker rewrote by hand to make it import.
  assert.equal(parsed.canonicalUrl, "https://speedhive.mylaps.com/practice/3472/activities/8354099722");
  assert.ok(asked.every((u) => u.startsWith("https://practice-api.speedhive.com/")));
});

test("a location-first link keeps its own address", async () => {
  stubPracticeApi();
  const parsed = await importSpeedhivePracticeActivity(
    "https://speedhive.mylaps.com/practice/3472/activities/8354099722"
  );
  assert.deepEqual(parsed.laps, [23.456, 23.157]);
  assert.equal(parsed.canonicalUrl, undefined);
});

test("a club's practice page says which link to paste instead of blaming the site", async () => {
  const asked = stubPracticeApi();
  const url = "https://speedhive.mylaps.com/practice/3472";
  assert.equal(isSpeedhivePracticeImportUrl(url), true, "answered here, not by the generic page reader");

  const parsed = await importSpeedhivePracticeActivity(url);

  assert.deepEqual(parsed.laps, []);
  assert.equal(parsed.errorCode, "unsupported_url");
  assert.match(String(parsed.message), /practice page, not one session/);
  assert.doesNotMatch(String(parsed.message), /JavaScript/);
  assert.equal(asked.length, 0, "nothing to fetch for a page that holds no session");
});
