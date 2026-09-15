/**
 * dev-seed-titc.ts — DEV ONLY, throwaway. The biggest meeting the Analysis block will ever
 * hold: ten days at one track, ten runs a day, the newest run today. Built 2026-09-14 so the
 * founder could look at the whole-meeting chart at its densest before deciding whether a
 * hundred dots in 340px is a picture or a problem.
 *
 *   - days 1–2: eventless practice at the track (they FOLD into the event — touching days)
 *   - days 3–10: "TITC 2026", declared start → end
 *   - practice → qualifying (Q1…Q5) → finals (A1…A3), pace improving across the fortnight
 *   - the front sway bar changes every fourth run so the wrench marks have something to show
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-titc.ts
 *
 * Prints a one-tap sign-in URL (`/api/auth/dev-signin`). Cleanup: `npm run onboarding:cleanup`
 * (the alias carries `+ob`).
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const BASE_EMAIL = "jordancaaruso@gmail.com";
const OUT = "e2e/.auth/titc.json";
const ZONE = "Asia/Bangkok"; // UTC+7, no DST
const DAYS = 10;
const RUNS_PER_DAY = 10;
const PRACTICE_DAYS_BEFORE_EVENT = 2;

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? process.env.AUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");

function freshAlias(): string {
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}+obtitc-${randomBytes(3).toString("hex")}@${domain}`;
}

/** Deterministic noise so two seeds look alike. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Twenty laps around a target best: a clean bulk, a couple of slow ones, one mistake. */
function lapsAround(best: number, seed: number): number[] {
  const laps: number[] = [best];
  for (let i = 1; i < 20; i += 1) {
    const n = noise(seed * 100 + i);
    const spread = i % 7 === 0 ? 0.9 + n * 0.6 : 0.05 + n * 0.35;
    laps.push(Number((best + spread).toFixed(3)));
  }
  if (seed % 3 === 0) laps[13] = Number((best + 2.4).toFixed(3)); // the mistake lap
  return laps;
}

const avgTop5 = (laps: number[]) =>
  [...laps].sort((a, b) => a - b).slice(0, 5).reduce((s, n) => s + n, 0) / 5;

/** Local wall clock in Bangkok → instant. */
function bangkok(ymd: string, hour: number, minute: number): Date {
  return new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+07:00`);
}

function ymdInZone(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Session = {
  meetingSessionType: "PRACTICE" | "QUALIFYING" | "RACE";
  meetingSessionCode: string | null;
  sessionLabel: string | null;
};

/** What the tenth run of day N is: practice first, then qualifying rounds, then finals. */
function sessionFor(dayIndex: number, runIndex: number): Session {
  if (dayIndex < 5) return { meetingSessionType: "PRACTICE", meetingSessionCode: null, sessionLabel: null };
  if (dayIndex < 8) {
    // Qualifying days: a practice in the morning, then rounds.
    if (runIndex < 3) return { meetingSessionType: "PRACTICE", meetingSessionCode: null, sessionLabel: null };
    const round = (dayIndex - 5) * 7 + (runIndex - 3) + 1;
    return { meetingSessionType: "QUALIFYING", meetingSessionCode: `Q${round}`, sessionLabel: null };
  }
  // Finals days.
  if (runIndex < 6) return { meetingSessionType: "PRACTICE", meetingSessionCode: null, sessionLabel: null };
  const leg = (dayIndex - 8) * 4 + (runIndex - 6) + 1;
  return { meetingSessionType: "RACE", meetingSessionCode: `A${leg}`, sessionLabel: null };
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  const email = freshAlias();
  await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });
  const user = await prisma.user.create({
    data: { email, name: "TITC Ten Days", timeZone: ZONE },
    select: { id: true },
  });

  const track = await prisma.track.create({
    data: { userId: user.id, name: "RC Addict Thailand" },
    select: { id: true, name: true },
  });
  const car = await prisma.car.create({
    data: { userId: user.id, name: "A800R", carClass: "touring~electric" },
    select: { id: true, name: true },
  });

  // Day 10 is today in Bangkok; day 1 is nine days back.
  const todayYmd = ymdInZone(new Date());
  const dayYmds = Array.from({ length: DAYS }, (_, i) => shiftYmd(todayYmd, i - (DAYS - 1)));
  const eventStartYmd = dayYmds[PRACTICE_DAYS_BEFORE_EVENT]!;
  const eventEndYmd = dayYmds[DAYS - 1]!;

  const event = await prisma.event.create({
    data: {
      userId: user.id,
      name: "TITC 2026",
      trackId: track.id,
      trackNameSnapshot: track.name,
      startDate: new Date(`${eventStartYmd}T12:00:00Z`),
      endDate: new Date(`${eventEndYmd}T12:00:00Z`),
    },
    select: { id: true, name: true },
  });

  const runIds: string[] = [];
  let seed = 0;
  for (const [dayIndex, ymd] of dayYmds.entries()) {
    const inEvent = dayIndex >= PRACTICE_DAYS_BEFORE_EVENT;
    for (let runIndex = 0; runIndex < RUNS_PER_DAY; runIndex += 1) {
      seed += 1;
      // 09:00 → 16:45, every 45 minutes... except the tenth run of today, which must not
      // land in the future or the page's "today" reasoning gets a run from later on.
      const at = bangkok(ymd, 9 + Math.floor((runIndex * 45) / 60), (runIndex * 45) % 60);
      if (at.getTime() > Date.now()) break;

      // Pace: 15.65 on day one, ~14.95 by the finals, with a per-run wobble and a slow
      // first run each morning (cold track, cold driver).
      const progress = (dayIndex * RUNS_PER_DAY + runIndex) / (DAYS * RUNS_PER_DAY);
      const morning = runIndex === 0 ? 0.18 : 0;
      const best = Number((15.65 - 0.7 * progress + morning + (noise(seed) - 0.5) * 0.14).toFixed(3));
      const laps = lapsAround(best, seed);

      const swayStep = Math.floor(seed / 4) % 3;
      const setup: Prisma.InputJsonObject = {
        camber_front: -2,
        camber_rear: -1.5,
        front_sway_bar: ["1.3", "1.4", "1.5"][swayStep]!,
        ride_height_front: 5,
        ride_height_rear: 5.5,
      };
      const snapshot = await prisma.setupSnapshot.create({
        data: { userId: user.id, carId: car.id, data: setup },
        select: { id: true },
      });

      const session = inEvent
        ? sessionFor(dayIndex, runIndex)
        : { meetingSessionType: "PRACTICE" as const, meetingSessionCode: null, sessionLabel: null };

      const run = await prisma.run.create({
        data: {
          userId: user.id,
          carId: car.id,
          carNameSnapshot: car.name,
          trackId: track.id,
          trackNameSnapshot: track.name,
          // THE POINT: the two practice days carry NO event and must fold in by touching.
          eventId: inEvent ? event.id : null,
          setupSnapshotId: snapshot.id,
          sessionType: inEvent ? "RACE_MEETING" : "PRACTICE",
          ...session,
          lapTimes: laps,
          bestLapSeconds: Math.min(...laps),
          avgTop5LapSeconds: avgTop5(laps),
          carRating: 4 + Math.round(noise(seed + 7) * 5),
          conditionsAirTempC: 31 + Math.round(noise(seed + 3) * 4),
          loggingComplete: true,
          loggingCompletedAt: at,
          sessionCompletedAt: at,
          createdAt: at,
          sortAt: at,
          localTimeZone: ZONE,
        },
        select: { id: true },
      });
      runIds.push(run.id);
    }
    console.log(`  ${ymd}${inEvent ? "  (event)" : "  (practice, no event)"}`);
  }

  const signInUrl = `${BASE}/api/auth/dev-signin?${new URLSearchParams({ email, to: "/analysis" })}`;
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ signInUrl, email, runIds, eventId: event.id }, null, 2));

  console.log(`\nAccount:  ${email}`);
  console.log(`Runs:     ${runIds.length} over ${DAYS} days at ${track.name}`);
  console.log(`Event:    ${event.name}, ${eventStartYmd} → ${eventEndYmd}`);
  console.log(`Wrote:    ${OUT}\n`);
  console.log(signInUrl + "\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
