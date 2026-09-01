/**
 * One-time repair for the wall-clock weather bug (fixed in NewRunForm 2026-08-31).
 *
 * Runs completed with a LiveRC/MyRCM timing import attached had their weather
 * looked up for the session's WALL-CLOCK hour read as UTC — e.g. a 3:59 PM
 * Bendigo session was stamped with 1:59 AM's air temp. Detection is exact:
 * `conditionsObservedAt` equals the session's local wall-clock hour stamped
 * as-if-UTC AND differs from the session's real UTC hour (zone from
 * `Run.localTimeZone`). Matching rows are re-fetched from Open-Meteo at the
 * true instant; a driver-entered track temp is preserved (Open-Meteo never
 * supplies one).
 *
 * SAFE BY DEFAULT: dry-run prints the plan and changes nothing.
 *   Dry-run: npx dotenv-cli -e .env.local -- npx tsx scripts/repair-conditions-wall-clock.mts
 *   Apply:   npx dotenv-cli -e .env.local -- npx tsx scripts/repair-conditions-wall-clock.mts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { fetchRunConditionsFromOpenMeteo, floorToUtcHourIso } from "@/lib/weather/openMeteo";
import { normalizeRunConditionsInput } from "@/lib/weather/runConditionsRecord";

const APPLY = process.argv.includes("--apply");
// Rows older than the localTimeZone column need a zone supplied by the operator
// (e.g. --assume-tz=Australia/Melbourne). Detection still requires the exact
// hour signature, so a wrong assumption finds nothing rather than misfiring.
const ASSUME_TZ = process.argv.find((a) => a.startsWith("--assume-tz="))?.slice("--assume-tz=".length) ?? null;

/** The (wrong) hour the buggy client asked for: local wall clock stamped as UTC. */
function wallClockAsUtcFloorHour(instant: Date, timeZone: string): string {
  // offset(tz at instant) = instant − (instant's digits reinterpreted wall→real)
  const offsetMs = instant.getTime() - wallClockAsUtcToInstant(instant, timeZone).getTime();
  return floorToUtcHourIso(new Date(instant.getTime() + offsetMs));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)\//)?.[1] ?? "?";
console.log(`${APPLY ? "APPLY" : "DRY-RUN"} against ${host}`);

const candidates = await prisma.run.findMany({
  where: {
    conditionsSource: { startsWith: "open-meteo" },
    sessionCompletedAt: { not: null },
    conditionsObservedAt: { not: null },
  },
  orderBy: { sortAt: "asc" },
  select: {
    id: true,
    localTimeZone: true,
    sessionCompletedAt: true,
    conditionsObservedAt: true,
    conditionsAirTempC: true,
    conditionsTrackTempC: true,
    conditionsLatitude: true,
    conditionsLongitude: true,
    track: { select: { name: true, latitude: true, longitude: true } },
    user: { select: { email: true } },
  },
});
console.log(`${candidates.length} runs with an Open-Meteo reading and a session time`);

let noZone = 0;
let clean = 0;
let repaired = 0;
let failed = 0;
const perUser = new Map<string, number>();

for (const run of candidates) {
  const sess = run.sessionCompletedAt!;
  const tz = run.localTimeZone?.trim() || ASSUME_TZ;
  if (!tz) {
    noZone++;
    continue;
  }
  const rightHour = floorToUtcHourIso(sess);
  const wrongHour = wallClockAsUtcFloorHour(sess, tz);
  const observedHour = floorToUtcHourIso(run.conditionsObservedAt!);
  if (observedHour !== wrongHour || wrongHour === rightHour) {
    clean++;
    continue;
  }

  const email = run.user.email ?? "?";
  perUser.set(email, (perUser.get(email) ?? 0) + 1);
  const lat = run.conditionsLatitude ?? run.track?.latitude ?? null;
  const lon = run.conditionsLongitude ?? run.track?.longitude ?? null;
  console.log(
    `BUGGED ${run.id} ${email} ${run.track?.name ?? "?"} session=${sess.toISOString()} ` +
      `observed=${observedHour} (should be ${rightHour}) air=${run.conditionsAirTempC}`
  );
  if (!APPLY) continue;
  if (lat == null || lon == null) {
    console.log(`  SKIP: no coordinates to re-fetch with`);
    failed++;
    continue;
  }
  try {
    const conditions = await fetchRunConditionsFromOpenMeteo({
      latitude: lat,
      longitude: lon,
      atIso: sess.toISOString(),
    });
    const cols = normalizeRunConditionsInput(conditions);
    if (!cols) throw new Error("empty reading returned");
    // A driver-typed probe temp outranks the lookup, which never produces one anyway.
    cols.conditionsTrackTempC = run.conditionsTrackTempC ?? cols.conditionsTrackTempC;
    await prisma.run.update({ where: { id: run.id }, data: cols });
    repaired++;
    console.log(
      `  FIXED: air ${run.conditionsAirTempC} -> ${cols.conditionsAirTempC}, ` +
        `observed ${observedHour} -> ${cols.conditionsObservedAt instanceof Date ? floorToUtcHourIso(cols.conditionsObservedAt) : "?"}`
    );
    await sleep(300); // be polite to Open-Meteo
  } catch (err) {
    failed++;
    console.log(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const bugged = [...perUser.values()].reduce((a, b) => a + b, 0);
console.log(
  `\nSummary: ${bugged} bugged, ${clean} clean, ${noZone} skipped (no localTimeZone)` +
    (APPLY ? `, ${repaired} repaired, ${failed} failed` : " — dry run, nothing written")
);
for (const [email, n] of [...perUser.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${email}: ${n}`);
}
await prisma.$disconnect();
