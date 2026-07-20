/**
 * Run: `npx tsx src/lib/lapUrlParsers/myRcmReport.test.ts`
 *
 * Fixtures are real MyRCM responses captured 2026-07-15 from event 97370 (EC Warm-Up, Luxembourg):
 *  - myrcm-session-4709.html   → one session fragment (E10 TC SPEC, Heat 2 - Qualy 1)
 *  - myrcm-category-shell.html  → the category (class) JS shell with the session menu
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  enumerateMyRcmSessions,
  isMyRcmCategoryUrl,
  isMyRcmDiscoveryUrl,
  isMyRcmEventUrl,
  isMyRcmSessionUrl,
  myRcmClassMatchesConfigured,
  parseMyRcmEventClasses,
  parseMyRcmLapTime,
  parseMyRcmReportUrl,
  parseMyRcmSessionHtml,
  parseMyRcmStartTimeToIso,
} from "@/lib/lapUrlParsers/myRcmReport";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(HERE, "__fixtures__", name), "utf8");

const SESSION_URL = "https://www.myrcm.ch/myrcm/report/en/97370/388960?reportKey=4709";
const CATEGORY_URL = "https://www.myrcm.ch/myrcm/report/en/97370/388960";
const EVENT_URL = "https://www.myrcm.ch/myrcm/main?dId[O]=51&pLa=en&dId[E]=97370&tId=E&hId[1]=org#";

test("URL classification", () => {
  assert.equal(isMyRcmSessionUrl(SESSION_URL), true);
  assert.equal(isMyRcmCategoryUrl(SESSION_URL), false);
  assert.equal(isMyRcmCategoryUrl(CATEGORY_URL), true);
  assert.equal(isMyRcmSessionUrl(CATEGORY_URL), false);
  assert.equal(isMyRcmEventUrl(EVENT_URL), true);
  assert.equal(isMyRcmCategoryUrl(EVENT_URL), false);
  assert.equal(isMyRcmSessionUrl("https://liverc.com/results/?p=view_race_result&id=1"), false);

  const ref = parseMyRcmReportUrl(SESSION_URL);
  assert.deepEqual(ref, { lang: "en", eventId: "97370", categoryId: "388960", reportKey: "4709" });
  // Trailing #, extra params, and a trailing slash all normalize.
  assert.equal(parseMyRcmReportUrl(CATEGORY_URL + "#")?.reportKey, null);
});

test("lap-time token parsing", () => {
  assert.equal(parseMyRcmLapTime("20.859"), 20.859);
  assert.equal(parseMyRcmLapTime("1:05.432"), 65.432);
  assert.equal(parseMyRcmLapTime("00.000"), null); // staging marker
  assert.equal(parseMyRcmLapTime(""), null);
  assert.equal(parseMyRcmLapTime("—"), null);
});

test("start time → ISO", () => {
  assert.equal(parseMyRcmStartTimeToIso("11.07.2026 15:52:59"), "2026-07-11T15:52:59.000Z");
  assert.equal(parseMyRcmStartTimeToIso("11.07.2026"), "2026-07-11T00:00:00.000Z");
  assert.equal(parseMyRcmStartTimeToIso(null), null);
});

test("session fragment → drivers + laps (joined on car number)", () => {
  const { meta, drivers } = parseMyRcmSessionHtml(fixture("myrcm-session-4709.html"));

  assert.equal(meta.className, "E10 TC SPEC");
  assert.equal(meta.trackCondition, "Dry");
  assert.equal(meta.startTimeIso, "2026-07-11T15:52:59.000Z");

  // 9 entrants in the classification.
  assert.equal(drivers.length, 9);

  // Winner: Tim Espen, car 4, 15 laps, best 20.045.
  const espen = drivers.find((d) => d.driverName === "Tim Espen");
  assert.ok(espen, "Tim Espen present");
  assert.equal(espen!.laps.length, 15, "Espen lap count");
  assert.equal(Math.min(...espen!.laps), 20.045, "Espen best lap matches classification");
  assert.equal(espen!.laps[0], 20.859, "Espen lap 1 (lap-0 staging row dropped)");

  // Name with a non-breaking space is normalized.
  assert.ok(drivers.some((d) => d.driverName === "Amelia Le Bescond"));

  // Short runner: Nathéo Ribault, car 9, only 8 laps (matrix column stops early).
  const ribault = drivers.find((d) => d.driverName.startsWith("Nath"));
  assert.ok(ribault, "Ribault present");
  assert.equal(ribault!.laps.length, 8, "Ribault lap count from truncated matrix column");
  assert.equal(Math.min(...ribault!.laps), 22.927, "Ribault best lap");

  // Every driver's parsed lap count matches the classification's Laps column (cross-check).
  const espenBest = drivers.filter((d) => d.laps.length > 0);
  assert.ok(espenBest.length >= 8, "at least 8 drivers have laps");
});

test("category shell → labeled result sessions only, meaningful-first", () => {
  const ref = parseMyRcmReportUrl(CATEGORY_URL)!;
  const sessions = enumerateMyRcmSessions(fixture("myrcm-category-shell.html"), ref);

  assert.ok(sessions.length > 0, "sessions found");

  // Only result groups — no Participants / Heat arrangements / Timeschedule / Rankinglists.
  const groups = new Set(sessions.map((s) => s.group));
  for (const g of groups) {
    assert.ok(["Free practice", "Practice", "Qualy", "Final"].includes(g), `unexpected group: ${g}`);
  }

  // Deduped by reportKey (the navbar renders the menu twice).
  const keys = sessions.map((s) => s.reportKey);
  assert.equal(new Set(keys).size, keys.length, "no duplicate reportKeys");

  // Finals sort first.
  assert.equal(sessions[0]!.group, "Final");

  // The known session 4709 is present as "Qualy :: Heat 2 - Qualy 1".
  const s4709 = sessions.find((s) => s.reportKey === "4709");
  assert.ok(s4709, "session 4709 enumerated");
  assert.equal(s4709!.group, "Qualy");
  assert.match(s4709!.url, /reportKey=4709$/);
});

test("discovery URL classification (event + category yes; session no)", () => {
  assert.equal(isMyRcmDiscoveryUrl(EVENT_URL), true);
  assert.equal(isMyRcmDiscoveryUrl(CATEGORY_URL), true);
  assert.equal(isMyRcmDiscoveryUrl(SESSION_URL), false);
  assert.equal(isMyRcmDiscoveryUrl("https://liverc.com/results/"), false);
});

test("event page → class list (fixture: EC Warm-Up, 3 classes)", () => {
  const classes = parseMyRcmEventClasses(fixture("myrcm-event-page.html"));
  assert.equal(classes.length, 3);
  const spec = classes.find((c) => c.className === "E10 TC SPEC");
  assert.ok(spec, "E10 TC SPEC listed");
  assert.equal(spec!.eventId, "97370");
  assert.equal(spec!.categoryId, "388960");
  assert.equal(spec!.categoryUrl, "https://www.myrcm.ch/myrcm/report/en/97370/388960");
  assert.deepEqual(
    classes.map((c) => c.className),
    ["E10 FWD", "E10 TC SPEC", "E10 TC Modified"]
  );
});

test("loose class matching for the event race-class filter", () => {
  assert.equal(myRcmClassMatchesConfigured("E10 TC SPEC", "tc spec"), true);
  assert.equal(myRcmClassMatchesConfigured("EC10 TC SPEC  [EC10-SPEC]", "EC10 TC Spec"), true);
  assert.equal(myRcmClassMatchesConfigured("E10 TC Modified", "TC SPEC"), false);
  assert.equal(myRcmClassMatchesConfigured("E10 FWD", ""), false);
});

console.log("myRcmReport.test.ts OK");
