/**
 * demo-timing-verify.ts — drive the real LiveRC parsers over the demo timing site.
 *
 *   npm run demo:timing:verify
 *
 * No database, no dev server: this proves the invented pages satisfy every reader the
 * URL Auto scan uses, in the order the scan uses them. If this passes, the only things
 * left between here and the picker are the track row and the driver-name setting.
 */
process.env.DEMO_TIMING_SITE = "1";

import {
  DEMO_DRIVER_NAME,
  DEMO_TIMING_ORIGIN,
  serveDemoTimingPage,
} from "@/lib/lapUrlParsers/demoTimingSite";
import { parseLiveRcDashboardHtml } from "@/lib/lapWatch/liveRcIndexHtmlParse";
import { extractRaceSessions } from "@/lib/lapWatch/livercSessionIndexParsers";
import {
  importLiveRcRaceResult,
  parseLiveRcRaceResultTableRows,
} from "@/lib/lapUrlParsers/livercRaceResult";
import { liveRcNameMatchesConfigured, normalizeLiveRcDriverNameForMatch } from "@/lib/lapWatch/liveRcNameNormalize";

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ok    ${label}`);
    return;
  }
  failures++;
  console.log(`  FAIL  ${label}`, detail === undefined ? "" : JSON.stringify(detail));
}

function mustServe(url: string): string {
  const page = serveDemoTimingPage(url);
  if (!page) throw new Error(`demo site did not answer ${url}`);
  return page.text;
}

async function main() {
  console.log(`\nDemo timing site: ${DEMO_TIMING_ORIGIN}\n`);

  // 1. Dashboard → current event hub (what resolveRaceEventHubUrl reads).
  console.log("1. Track dashboard");
  const dashUrl = `${DEMO_TIMING_ORIGIN}/`;
  const dash = parseLiveRcDashboardHtml(mustServe(dashUrl), dashUrl);
  check("current event hub found", Boolean(dash.currentEventHubUrl), dash.currentEventHubUrl);
  check("event label found", Boolean(dash.currentEventLabel), dash.currentEventLabel);
  const hubUrl = dash.currentEventHubUrl!;
  console.log(`        hub: ${hubUrl}`);
  console.log(`        label: ${dash.currentEventLabel}`);

  // 2. Practice must find nothing — one race session is the whole demo.
  console.log("\n2. Practice calendar");
  const practiceUrl = `${DEMO_TIMING_ORIGIN}/practice/`;
  const practiceHtml = mustServe(practiceUrl);
  check("no practice days published", !/[?&]d=\d{4}-\d{2}-\d{2}/.test(practiceHtml));

  // 3. Event hub → race rows, each with a parseable completion time.
  console.log("\n3. Event hub");
  const races = extractRaceSessions(mustServe(hubUrl), hubUrl);
  check("three races listed", races.length === 3, races.length);
  for (const r of races) {
    check(
      `race ${r.sessionId} has a completion time`,
      Boolean(r.sessionCompletedAtIso),
      { label: r.listLinkText, raw: r.sessionTime },
    );
    console.log(`        ${r.listLinkText}  ->  ${r.sessionCompletedAtIso}  [class: ${r.raceClass}]`);
  }
  const today = new Date().toDateString();
  check(
    "every race completed today",
    races.every((r) => r.sessionCompletedAtIso && new Date(r.sessionCompletedAtIso).toDateString() === today),
    races.map((r) => r.sessionCompletedAtIso),
  );

  // 4. Membership crawl — exactly one race contains the demo driver.
  console.log("\n4. Membership crawl (which races is the driver in?)");
  const driverNorm = normalizeLiveRcDriverNameForMatch(DEMO_DRIVER_NAME);
  const matched: string[] = [];
  for (const r of races) {
    const rows = parseLiveRcRaceResultTableRows(mustServe(r.sessionUrl));
    const hit = rows.some((row) => liveRcNameMatchesConfigured(row.driverName, driverNorm));
    console.log(`        ${r.listLinkText}: ${rows.length} drivers, ${DEMO_DRIVER_NAME} ${hit ? "IN" : "not in"}`);
    if (hit) matched.push(r.sessionUrl);
  }
  check("exactly one session matches the driver", matched.length === 1, matched);

  // 5. Full import of that session, through the real race-result parser.
  console.log("\n5. Import the matched session");
  const result = await importLiveRcRaceResult(matched[0]!, DEMO_DRIVER_NAME);
  check("no error code", !result.errorCode, result.errorCode);
  check("session time parsed", Boolean(result.sessionCompletedAtIso), result.sessionCompletedAtIso);
  check("full field returned", (result.sessionDrivers?.length ?? 0) === 10, result.sessionDrivers?.length);
  check("demo driver is primary", result.sessionDrivers?.[0]?.driverName === DEMO_DRIVER_NAME, result.sessionDrivers?.[0]?.driverName);
  check("17 laps imported", result.laps.length === 17, result.laps.length);
  check("every driver has laps", (result.sessionDrivers ?? []).every((d) => d.laps.length === 17));

  const best = Math.min(...result.laps);
  const sorted = [...result.laps].sort((a, b) => a - b);
  const avgTop5 = sorted.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  console.log(`\n        completed:  ${result.sessionCompletedAtIso}`);
  console.log(`        best lap:   ${best.toFixed(3)}s`);
  console.log(`        avg top 5:  ${avgTop5.toFixed(3)}s`);
  console.log(`        laps:       ${result.laps.map((l) => l.toFixed(3)).join(", ")}`);
  console.log(`        field:      ${(result.sessionDrivers ?? []).map((d) => d.driverName).join(" · ")}`);
  const flagged = (result.lapRows ?? []).filter((r) => r.isOutlierWarning);
  console.log(`        flagged:    ${flagged.length === 0 ? "none" : flagged.map((r) => r.time.toFixed(3)).join(", ")}`);

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
