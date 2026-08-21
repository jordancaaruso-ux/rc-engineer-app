/**
 * Live canary for the MyRCM reader: `npm run test:myrcm-live`
 *
 * The unit tests run against saved pages, which is exactly how this feature died unnoticed — MyRCM
 * rebuilt their whole site on 18.08.2026 and all eight tests stayed green against fixtures of a
 * site that no longer existed. This script reads myrcm.ch **as it is right now** and fails loudly
 * when the shapes move again.
 *
 * It discovers its own event from the archive rather than pinning an id, so it keeps working as
 * events age out. Needs network; it is deliberately not part of `npx tsc --noEmit` or the unit run.
 */

import { fetchUrlText } from "@/lib/lapUrlParsers/fetchText";
import {
  buildMyRcmEventUrl,
  enumerateMyRcmSessions,
  parseMyRcmEventClasses,
  parseMyRcmReportUrl,
  parseMyRcmSelectedClassName,
  parseMyRcmSessionHtml,
} from "@/lib/lapUrlParsers/myRcmReport";

const ARCHIVE_URL = "https://www.myrcm.ch/en/archive";
/** How many archived events to try before giving up — most club events carry a single class. */
const MAX_EVENTS_TO_TRY = 12;

let failures = 0;
function check(label: string, ok: boolean, detail?: string): boolean {
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
  return ok;
}

async function main(): Promise<void> {
  console.log(`MyRCM live check — ${ARCHIVE_URL}\n`);

  const archive = await fetchUrlText(ARCHIVE_URL);
  check("archive page fetched", archive.ok, archive.ok ? undefined : archive.error);
  if (!archive.ok) process.exit(1);

  const eventIds = [
    ...new Set([...archive.text.matchAll(/\/en\/report\/(\d+)"/g)].map((m) => m[1]!)),
  ];
  check("archive lists events", eventIds.length > 0, `${eventIds.length} found`);
  if (eventIds.length === 0) process.exit(1);

  // Walk recent events until one has a run with results — a club event that was cancelled or is
  // still pending is normal and is not a parser failure.
  for (const eventId of eventIds.slice(0, MAX_EVENTS_TO_TRY)) {
    const eventUrl = buildMyRcmEventUrl(eventId);
    const ref = parseMyRcmReportUrl(eventUrl);
    if (!ref) continue;

    const page = await fetchUrlText(eventUrl);
    if (!page.ok) continue;

    const sessions = enumerateMyRcmSessions(page.text, ref);
    const runnable = sessions.find((s) => s.hasResults);
    if (!runnable) continue;

    const classes = parseMyRcmEventClasses(page.text, eventId);
    const shownClass = parseMyRcmSelectedClassName(page.text);
    console.log(
      `\nevent ${eventId} — ${sessions.length} run(s), ${classes.length} class(es), showing "${shownClass ?? "?"}"\n`
    );

    check("event page enumerates runs", sessions.length > 0, `${sessions.length}`);
    check("class picker read", classes.length > 0, classes.map((c) => c.className).join(", "));
    check("run labels are not blank", Boolean(runnable.label.trim()), `"${runnable.label}"`);
    check("run URL carries a reportKey", /reportKey=\d+/.test(runnable.url), runnable.url);

    const session = await fetchUrlText(runnable.url);
    check("run page fetched", session.ok, session.ok ? undefined : session.error);
    if (!session.ok) break;

    const { meta, drivers, lapCountsAgree } = parseMyRcmSessionHtml(session.text);
    const withLaps = drivers.filter((d) => d.laps.length > 0);

    check("run has a name", Boolean(meta.sessionName), meta.sessionName ?? "(none)");
    check("start time parsed", Boolean(meta.startTimeIso), meta.startTimeIso ?? meta.startTimeRaw ?? "(none)");
    check("field read", drivers.length > 0, `${drivers.length} drivers`);
    check("laps read", withLaps.length > 0, `${withLaps.length} with laps`);
    // The lap matrix is joined by column order; this is the assertion that the join held.
    check("lap counts match MyRCM's own classification", lapCountsAgree);

    const fastest = withLaps.flatMap((d) => d.laps).sort((a, b) => a - b)[0];
    check(
      "lap times are plausible (1s–5min)",
      fastest != null && fastest > 1 && fastest < 300,
      fastest != null ? `${fastest}s` : "(none)"
    );

    console.log(`\n  sample: ${withLaps[0]?.driverName} — ${withLaps[0]?.laps.length} laps`);
    break;
  }

  console.log(
    failures === 0
      ? "\nAll good — the reader still matches the live site."
      : `\n${failures} check(s) failed — MyRCM has probably changed again. Re-save the fixtures and re-read myRcmReport.ts.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();
