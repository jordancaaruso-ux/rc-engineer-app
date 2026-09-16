/**
 * dev-notif-test-day.ts — DEV ONLY. Builds the fixture the 8 pm evening summary is tested against:
 * one throwaway driver, one track nobody else has ever raced at, and a day of runs at it.
 *
 * Why a track of its own: the evening pass acts for every listening driver AT A TRACK, so a track
 * with exactly one driver on it has a blast radius of one. Its Speedhive URL is deliberately the
 * bare host — `organizationIdFromTrackUrl` and `practiceLocationIdFromTrackUrl` both return null
 * for it, so the pass makes no network call at all and only the notification is under test.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-notif-test-day.ts --mode=full
 *
 * Modes: full (3 runs + 1 unconfirmed + 1 loose) | loose (no runs, 2 loose) | empty | wipe |
 *        night (full, but the loose session is at 19:45 — the 8 pm look must hold the summary for 8 am).
 * Sign in as the driver at /api/auth/dev-signin?email=<the address it prints>.
 */
import { writeFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { setLiveRcDriverNameSetting, setSpeedhiveTransponderNumbersSetting } from "@/lib/appSettings";
import { organizationIdFromTrackUrl } from "@/lib/speedhive/speedhiveUrl";
import { practiceLocationIdFromTrackUrl } from "@/lib/speedhive/speedhivePracticeUrl";
import { buildDebriefRecap, type DebriefRunSource } from "@/lib/debrief/buildDebriefRecap";
import { todayBoundsInTimeZone } from "@/lib/eventActive";
import { confirmRunReturnHref } from "@/lib/runs/confirmRunHref";
import { renderEveningSummaryEmail, renderEveningSummaryPush } from "@/lib/sweep/eveningSummary";
import { deleteDoc } from "@/lib/sweep/blobStore";
import { trackDayDocKey } from "@/lib/sweep/sweepDocs";

const EMAIL = "notif-test@jrcdynamics.test";
const TRACK_NAME = "Notification Test Raceway";
const ZONE = "Australia/Sydney";
/** Bare host on purpose — parses to no organisation and no practice location, so nothing is fetched. */
const SPEEDHIVE_URL = "https://speedhive.mylaps.com/";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const MODE = (argValue("mode") ?? "full") as "full" | "loose" | "empty" | "wipe" | "preview" | "night";

const lapsAround = (best: number): number[] =>
  [best + 1.9, best + 0.31, best + 0.12, best, best + 0.08, best + 0.22, best + 0.17, best + 0.44];

const avgTop5 = (laps: number[]) =>
  [...laps].sort((a, b) => a - b).slice(0, 5).reduce((s, n) => s + n, 0) / 5;

/** Today at HH:MM in the track's zone, as a UTC instant. */
function todayAt(hour: number, minute: number): Date {
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  // Sydney is +10:00 (AEST) until 4 Oct 2026; the fixture only ever runs today, so a fixed
  // offset is honest here and avoids pulling in a tz library.
  return new Date(`${local}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+10:00`);
}

/**
 * What the driver would actually be sent for the fixture as it now stands — the same two renderers
 * `eveningPass.deliverEveningSummary` calls, over the same query. Prints the push and writes the
 * email to an .html file so the real thing can be looked at rather than imagined.
 */
async function preview(userId: string, trackId: string, trackName: string) {
  const day = todayBoundsInTimeZone(ZONE, new Date());
  const [runs, loose] = await Promise.all([
    prisma.run.findMany({
      where: { userId, trackId, sortAt: { gte: day.start, lt: day.end } },
      orderBy: [{ sortAt: "desc" }, { createdAt: "desc" }],
    }),
    prisma.importedLapTimeSession.findMany({
      where: { userId, trackId, linkedRunId: null, sweepFiledAt: { gte: day.start } },
      orderBy: { sessionCompletedAt: "asc" },
      select: { id: true },
    }),
  ]);
  if (runs.length === 0 && loose.length === 0) {
    console.log("\n=== NOTHING WOULD BE SENT (no runs, no loose sessions today) ===\n");
    return;
  }
  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    timeZone: ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date());
  const recap =
    runs.length > 0
      ? buildDebriefRecap(
          {
            title: "Test day",
            type: "Testing",
            trackName,
            dateLabel,
            runs: runs as unknown as DebriefRunSource[],
          },
          { zones: { viewerTimeZone: ZONE } },
        )
      : null;
  const anchorRunId = recap?.best?.runId ?? runs[0]?.id ?? null;
  // Mirrors eveningPass: the day when there is one, else the dashboard, plus the sheet's flag.
  const base = anchorRunId ? confirmRunReturnHref(anchorRunId) : "/";
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date());
  const summary = {
    trackName,
    dateLabel,
    recap,
    runCount: runs.length,
    unconfirmedCount: runs.filter((r) => r.unconfirmedAt != null).length,
    looseCount: loose.length,
    openPath:
      loose.length > 0
        ? `${base}${base.includes("?") ? "&" : "?"}whichCar=${encodeURIComponent(trackId)}&ymd=${ymd}`
        : base,
  };

  const push = renderEveningSummaryPush(summary);
  const email = renderEveningSummaryEmail(summary);
  console.log("\n=== PUSH (what lands on the lock screen) ===");
  console.log(`  title: ${push.title}`);
  console.log(`  body:  ${push.body}`);
  console.log(`  opens: ${push.url}`);
  console.log("\n=== EMAIL (only when the driver has no device) ===");
  console.log(`  subject: ${email.subject}`);
  console.log(email.text.split("\n").map((l) => `  | ${l}`).join("\n"));
  const out = "C:/Users/Jordan/AppData/Local/Temp/claude/c--Users-Jordan-rc-engineer-app/3253efa3-929b-456d-a687-dd553e52d9e4/scratchpad/evening-email.html";
  writeFileSync(out, email.html, "utf8");
  console.log(`\n  email HTML written to ${out}`);
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  console.log(
    `Speedhive URL parses to: organisation=${organizationIdFromTrackUrl(SPEEDHIVE_URL)}, ` +
      `practice=${practiceLocationIdFromTrackUrl(SPEEDHIVE_URL)} (both null = no network calls)`,
  );

  await prisma.authAllowedEmail.upsert({ where: { email: EMAIL }, update: {}, create: { email: EMAIL } });
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: { timeZone: ZONE },
    create: { email: EMAIL, name: "Notify Tester", emailVerified: new Date(), timeZone: ZONE },
    select: { id: true },
  });

  // Identity: a chip of his own is what puts a driver in the nightly plan.
  await setSpeedhiveTransponderNumbersSetting(user.id, JSON.stringify([9911223]));
  await setLiveRcDriverNameSetting(user.id, "Notify Tester");

  const existingTrack = await prisma.track.findFirst({
    where: { userId: user.id, name: TRACK_NAME },
    select: { id: true },
  });
  const track = existingTrack
    ? await prisma.track.update({
        where: { id: existingTrack.id },
        data: { speedhiveUrl: SPEEDHIVE_URL, timeZone: ZONE },
        select: { id: true, name: true },
      })
    : await prisma.track.create({
        data: { userId: user.id, name: TRACK_NAME, speedhiveUrl: SPEEDHIVE_URL, timeZone: ZONE },
        select: { id: true, name: true },
      });

  if (MODE === "preview") {
    await preview(user.id, track.id, track.name);
    return;
  }

  // Always start from a clean day so the fixture is repeatable — including the track's own
  // schedule document, which remembers who was already told today and would otherwise make a
  // second forced look a no-op (the 8 pm look never tells a driver twice).
  await deleteDoc(trackDayDocKey(track.id));
  await prisma.importedLapTimeSession.deleteMany({ where: { userId: user.id } });
  await prisma.run.deleteMany({ where: { userId: user.id } });

  if (MODE === "wipe") {
    await prisma.track.deleteMany({ where: { userId: user.id } });
    await prisma.car.deleteMany({ where: { userId: user.id } });
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } });
    await prisma.nativePushDevice.deleteMany({ where: { userId: user.id } });
    console.log("\nWiped the fixture (the account itself stays).\n");
    return;
  }

  const existingCar = await prisma.car.findFirst({ where: { userId: user.id }, select: { id: true, name: true } });
  const car =
    existingCar ??
    (await prisma.car.create({
      data: { userId: user.id, name: "TC01", carClass: "touring" },
      select: { id: true, name: true },
    }));

  if (MODE === "full" || MODE === "night") {
    const plan = [
      { at: todayAt(9, 5), best: 17.612, rating: 5, unconfirmed: false, label: "Practice 1" },
      { at: todayAt(10, 20), best: 17.234, rating: 8, unconfirmed: false, label: "Qualifier 1" },
      { at: todayAt(11, 40), best: 17.401, rating: 7, unconfirmed: true, label: "Qualifier 2" },
    ];
    for (const [i, step] of plan.entries()) {
      const setup: Prisma.InputJsonObject = {
        camber_front: -2,
        camber_rear: -1.5,
        front_sway_bar: "1.4",
        ride_height_front: 5,
        ride_height_rear: 5.5,
      };
      const snapshot = await prisma.setupSnapshot.create({
        data: { userId: user.id, carId: car.id, data: setup },
        select: { id: true },
      });
      const laps = lapsAround(step.best);
      const run = await prisma.run.create({
        data: {
          userId: user.id,
          carId: car.id,
          carNameSnapshot: car.name,
          trackId: track.id,
          trackNameSnapshot: track.name,
          setupSnapshotId: snapshot.id,
          sessionType: "RACE_MEETING",
          meetingSessionType: i === 0 ? "PRACTICE" : "QUALIFYING",
          meetingSessionCode: i === 0 ? "1" : String(i),
          sessionLabel: step.label,
          lapTimes: laps,
          bestLapSeconds: Math.min(...laps),
          avgTop5LapSeconds: avgTop5(laps),
          carRating: step.rating,
          loggingComplete: !step.unconfirmed,
          loggingCompletedAt: step.unconfirmed ? null : step.at,
          unconfirmedAt: step.unconfirmed ? step.at : null,
          sessionCompletedAt: step.at,
          createdAt: step.at,
          sortAt: step.at,
          localTimeZone: ZONE,
        },
        select: { id: true },
      });
      console.log(
        `  Run ${i + 1} (${step.label}): best ${Math.min(...laps).toFixed(3)}` +
          `${step.unconfirmed ? "  [unconfirmed]" : ""}  ${run.id}`,
      );
    }
  }

  const looseCount = MODE === "full" || MODE === "night" ? 1 : MODE === "loose" ? 2 : 0;
  for (let i = 0; i < looseCount; i += 1) {
    // Night mode: still on track at 19:45, inside the half hour before 8 pm that holds the summary.
    const at = MODE === "night" ? todayAt(19, 45) : todayAt(13, 15 + i * 40);
    const session = await prisma.importedLapTimeSession.create({
      data: {
        userId: user.id,
        trackId: track.id,
        sourceUrl: `https://speedhive.mylaps.com/sessions/notif-test-${MODE}-${i}`,
        parserId: "speedhive",
        sourceType: "timing_url",
        parsedPayload: { laps: lapsAround(17.5), driverName: "Notify Tester" } as Prisma.InputJsonObject,
        sessionCompletedAt: at,
        sweepFiledAt: new Date(),
        linkedRunId: null,
      },
      select: { id: true },
    });
    console.log(`  Loose session ${i + 1}: ${session.id}`);
  }

  await preview(user.id, track.id, track.name);

  console.log(`\nMode:     ${MODE}`);
  console.log(`Driver:   ${EMAIL}`);
  console.log(`Track:    ${track.name}  (${track.id})`);
  console.log(`\nSign in:  /api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}`);
  console.log(`Force:    /api/cron/timing-sweep?evening=${track.id}   (Bearer CRON_SECRET)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
