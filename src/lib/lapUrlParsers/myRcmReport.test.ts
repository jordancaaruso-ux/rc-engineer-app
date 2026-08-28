/**
 * Run: `npx tsx --test src/lib/lapUrlParsers/myRcmReport.test.ts`
 *
 * Fixtures are real MyRCM **v9** responses captured 2026-08-19, the day after the site rebuild
 * (v9.1.15, 18.08.2026). Inline `<svg>`, `<script>` and `<style>` were stripped to keep them
 * readable; nothing the parser selects on was touched.
 *
 *  - myrcm-v9-event-multiclass.html  → event 97370 (EC Warm-Up, Luxembourg) — 3 classes in the picker
 *  - myrcm-v9-class-runs.html        → event 99719 / class 395535 — 5 runs, one still pending
 *  - myrcm-v9-session-2drivers.html  → 99719/395535 reportKey 6058 — lap columns keyed "# 2"/"# 1",
 *                                      i.e. NOT the driver name, so the join is positional
 *  - myrcm-v9-session-chunked.html   → 99745/395609 reportKey 57698 — 16 drivers, so the lap matrix
 *                                      is split into two 10-column chunks
 *
 * The old pre-v9 fixtures are deliberately gone: they kept every test green while the feature was
 * dead in production, which is the failure this file exists to prevent repeating.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildMyRcmSessionUrl,
  classifyMyRcmEventLink,
  enumerateMyRcmSessions,
  isMyRcmCategoryUrl,
  isMyRcmDiscoveryUrl,
  isMyRcmEventUrl,
  isMyRcmSessionUrl,
  legacyMyRcmEventIdFromUrl,
  myRcmClassMatchesConfigured,
  parseMyRcmEventClasses,
  parseMyRcmLapTime,
  parseMyRcmReportUrl,
  parseMyRcmSelectedClassName,
  parseMyRcmSessionHtml,
  parseMyRcmStartTimeToIso,
} from "@/lib/lapUrlParsers/myRcmReport";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(HERE, "__fixtures__", name), "utf8");

const SESSION_URL = "https://www.myrcm.ch/en/report/99719/395535?reportKey=6058&reportType=qualy";
const CLASS_URL = "https://www.myrcm.ch/en/report/99719/395535";
const EVENT_URL = "https://www.myrcm.ch/en/report/97370";
const LEGACY_SESSION_URL = "https://www.myrcm.ch/myrcm/report/en/97370/388960?reportKey=4709";
const LEGACY_EVENT_URL =
  "https://www.myrcm.ch/myrcm/main?dId[O]=51&pLa=en&dId[E]=97370&tId=E&hId[1]=org#";

test("classifyMyRcmEventLink: a heat link is stored as its class page", () => {
  // The whole point: a driver pastes the run they are looking at, and that run is over. Storing
  // it would send them back to last round's result every meeting.
  const heat = classifyMyRcmEventLink(SESSION_URL);
  assert.equal(heat.ok, true);
  assert.equal(heat.ok && heat.url, CLASS_URL);

  const legacyHeat = classifyMyRcmEventLink(LEGACY_SESSION_URL);
  assert.equal(legacyHeat.ok, true);
  assert.equal(legacyHeat.ok && legacyHeat.url, "https://www.myrcm.ch/en/report/97370/388960");
});

test("classifyMyRcmEventLink: class and event pages are kept as they are", () => {
  const cls = classifyMyRcmEventLink(CLASS_URL);
  assert.equal(cls.ok && cls.url, CLASS_URL);

  // An event link must NOT be promoted to a class: which class is theirs is unknowable without
  // reading the page, and reading MyRCM is exactly what we may not do.
  const ev = classifyMyRcmEventLink(EVENT_URL);
  assert.equal(ev.ok && ev.url, EVENT_URL);

  const legacyEvent = classifyMyRcmEventLink(LEGACY_EVENT_URL);
  assert.equal(legacyEvent.ok && legacyEvent.url, "https://www.myrcm.ch/en/report/97370");
});

test("classifyMyRcmEventLink: bare hostname, other language, and rejections", () => {
  const bare = classifyMyRcmEventLink("www.myrcm.ch/en/report/99719/395535");
  assert.equal(bare.ok && bare.url, CLASS_URL);

  // A German driver's link stays German.
  const de = classifyMyRcmEventLink("https://www.myrcm.ch/de/report/99719/395535?reportKey=6058");
  assert.equal(de.ok && de.url, "https://www.myrcm.ch/de/report/99719/395535");

  const home = classifyMyRcmEventLink("https://www.myrcm.ch/");
  assert.equal(home.ok, false);
  assert.match(home.ok ? "" : home.error, /not a results page/i);

  const liveRc = classifyMyRcmEventLink("https://tftr.liverc.com/results/");
  assert.equal(liveRc.ok, false);
  assert.match(liveRc.ok ? "" : liveRc.error, /isn't a MyRCM link/i);

  assert.equal(classifyMyRcmEventLink("   ").ok, false);
});

test("URL classification (v9 shapes)", () => {
  assert.equal(isMyRcmSessionUrl(SESSION_URL), true);
  assert.equal(isMyRcmCategoryUrl(SESSION_URL), false);

  assert.equal(isMyRcmCategoryUrl(CLASS_URL), true);
  assert.equal(isMyRcmSessionUrl(CLASS_URL), false);

  assert.equal(isMyRcmEventUrl(EVENT_URL), true);
  assert.equal(isMyRcmCategoryUrl(EVENT_URL), false);

  assert.equal(isMyRcmSessionUrl("https://www.myrcm.ch/en/live/97593"), false);
  assert.equal(isMyRcmEventUrl("https://liverc.com/results/"), false);
});

test("legacy URLs still parse — MyRCM's own redirect drops the reportKey", () => {
  const ref = parseMyRcmReportUrl(LEGACY_SESSION_URL);
  assert.ok(ref);
  assert.equal(ref.eventId, "97370");
  assert.equal(ref.categoryId, "388960");
  assert.equal(ref.reportKey, "4709");

  // Rebuilt in the v9 shape, keeping the key that the 302 would have thrown away.
  assert.equal(
    buildMyRcmSessionUrl(ref, ref.reportKey!),
    "https://www.myrcm.ch/en/report/97370/388960?reportKey=4709"
  );

  assert.equal(isMyRcmEventUrl(LEGACY_EVENT_URL), true);
  assert.equal(legacyMyRcmEventIdFromUrl(LEGACY_EVENT_URL), "97370");
  assert.equal(legacyMyRcmEventIdFromUrl(EVENT_URL), null);
});

test("reportType survives a round trip", () => {
  const ref = parseMyRcmReportUrl(SESSION_URL);
  assert.ok(ref);
  assert.equal(ref.reportType, "qualy");
  assert.equal(
    buildMyRcmSessionUrl(ref, "6063"),
    "https://www.myrcm.ch/en/report/99719/395535?reportKey=6063&reportType=qualy"
  );
});

test("lap-time token parsing", () => {
  assert.equal(parseMyRcmLapTime("20.859"), 20.859);
  assert.equal(parseMyRcmLapTime("08.740"), 8.74);
  assert.equal(parseMyRcmLapTime("1:05.432"), 65.432);
  assert.equal(parseMyRcmLapTime("00.000"), null);
  assert.equal(parseMyRcmLapTime(""), null);
  assert.equal(parseMyRcmLapTime("-"), null);
  // The lap-0 staging cell holds a wall clock, not a lap.
  assert.equal(parseMyRcmLapTime("43:15.591"), 2595.591);
});

test("start time → ISO", () => {
  assert.equal(parseMyRcmStartTimeToIso("16.08.2026 13:48:42"), "2026-08-16T13:48:42.000Z");
  assert.equal(parseMyRcmStartTimeToIso("18.08.2026"), "2026-08-18T00:00:00.000Z");
  assert.equal(parseMyRcmStartTimeToIso("nonsense"), null);
  assert.equal(parseMyRcmStartTimeToIso(null), null);
});

test("session → whole field, joined positionally when columns aren't named", () => {
  const { meta, drivers, lapCountsAgree } = parseMyRcmSessionHtml(
    fixture("myrcm-v9-session-2drivers.html")
  );

  assert.equal(meta.sessionName, "Heat 19");
  assert.equal(meta.eventName, "Online Event");
  assert.equal(meta.startTimeRaw, "16.08.2026 13:48:42");
  assert.equal(meta.startTimeIso, "2026-08-16T13:48:42.000Z");

  assert.equal(drivers.length, 2);
  // Lap columns here are labelled "# 2" / "# 1" — nothing to do with the driver — so the only
  // usable join is column order, and the classification's own lap count is what proves it held.
  assert.equal(drivers[0]!.driverName, "Hansruedi Baer");
  assert.equal(drivers[0]!.laps.length, 33);
  assert.equal(drivers[1]!.laps.length, 5);
  assert.equal(lapCountsAgree, true);

  // Baer's best per MyRCM's own classification is 8.443.
  assert.equal(Math.min(...drivers[0]!.laps), 8.443);
  // The lap-0 staging row (a 43-minute wall clock) must not be counted as a lap.
  assert.ok(Math.max(...drivers[0]!.laps) < 120);
});

test("session → lap matrix split across chunks stays in classification order", () => {
  const { drivers, lapCountsAgree } = parseMyRcmSessionHtml(
    fixture("myrcm-v9-session-chunked.html")
  );

  // 16 drivers, so MyRCM renders two lap tables (10 + 6). Concatenating the chunks must reproduce
  // the finishing order — get this wrong and every driver silently gets someone else's laps.
  assert.equal(drivers.length, 16);
  assert.equal(lapCountsAgree, true);

  assert.equal(drivers[0]!.driverName, "Kart 14");
  assert.equal(drivers[0]!.laps.length, 37);
  assert.equal(drivers[1]!.driverName, "Kart 5");
  assert.equal(drivers[1]!.laps.length, 32);

  // Everyone from P3 down was a DNS: present in the field, no laps.
  for (const d of drivers.slice(2)) assert.equal(d.laps.length, 0);

  // Drivers 11-16 come from the second chunk — proof the chunk boundary was crossed correctly.
  assert.equal(drivers[10]!.driverName, "Kart 10");
  assert.equal(drivers[15]!.driverName, "Kart 11");
});

test("class page → runs, deduped, with pending ones flagged", () => {
  const ref = parseMyRcmReportUrl(CLASS_URL)!;
  const sessions = enumerateMyRcmSessions(fixture("myrcm-v9-class-runs.html"), ref);

  // The accordion is rendered twice on the page; without dedupe this is 10.
  assert.equal(sessions.length, 5);
  assert.deepEqual(
    sessions.map((s) => s.reportKey),
    ["6058", "6063", "6064", "6065", "6066"]
  );

  assert.equal(sessions.filter((s) => s.hasResults).length, 4);
  assert.equal(sessions.find((s) => s.reportKey === "6066")!.hasResults, false);

  const first = sessions[0]!;
  assert.equal(first.group, "Qualifying");
  assert.equal(first.label, "Heat 19 · Qualy 1");
  assert.equal(first.title, "Qualifying · Heat 19 · Qualy 1");
  assert.equal(
    first.url,
    "https://www.myrcm.ch/en/report/99719/395535?reportKey=6058&reportType=qualy"
  );
});

test("class page → the class it is showing", () => {
  assert.equal(parseMyRcmSelectedClassName(fixture("myrcm-v9-class-runs.html")), "Online");
});

test("event page → class picker (fixture: EC Warm-Up, 3 classes)", () => {
  const classes = parseMyRcmEventClasses(fixture("myrcm-v9-event-multiclass.html"), "97370");
  assert.deepEqual(
    classes.map((c) => c.className),
    ["E10 FWD", "E10 TC SPEC", "E10 TC Modified"]
  );
  assert.deepEqual(
    classes.map((c) => c.categoryId),
    ["388959", "388960", "388961"]
  );
  assert.equal(classes[1]!.categoryUrl, "https://www.myrcm.ch/en/report/97370/388960");
});

test("event page enumerates runs too — it renders its first class", () => {
  const ref = parseMyRcmReportUrl(EVENT_URL)!;
  const sessions = enumerateMyRcmSessions(fixture("myrcm-v9-event-multiclass.html"), ref);
  // 28 buttons on the page, 14 distinct runs.
  assert.equal(sessions.length, 14);
  assert.ok(sessions.every((s) => /reportKey=\d+/.test(s.url)));
});

test("discovery URL classification (event + class yes; single run no)", () => {
  assert.equal(isMyRcmDiscoveryUrl(EVENT_URL), true);
  assert.equal(isMyRcmDiscoveryUrl(CLASS_URL), true);
  assert.equal(isMyRcmDiscoveryUrl(SESSION_URL), false);
  assert.equal(isMyRcmDiscoveryUrl(LEGACY_EVENT_URL), true);
});

test("loose class matching for the event race-class filter", () => {
  assert.equal(myRcmClassMatchesConfigured("E10 TC SPEC [EC10-SPEC]", "TC Spec"), true);
  assert.equal(myRcmClassMatchesConfigured("E10 TC Modified", "TC Spec"), false);
  assert.equal(myRcmClassMatchesConfigured("", "TC Spec"), false);
});
