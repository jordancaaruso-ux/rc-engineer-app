/**
 * dev-seed-practice-day.ts — DEV ONLY, throwaway. One account, one car, one event, and FIVE runs
 * today that are all "Practice" and nothing else: no session code, no session label. That is the
 * exact day the founder reported on 2026-08-25, where the dashboard's Pace row read
 * "Best run was Practice" — true of every run on it, and therefore a pointer at nothing.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-practice-day.ts
 *
 * Cleanup: `npm run onboarding:cleanup` (the alias carries `+ob`).
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const BASE_EMAIL = "jordancaaruso@gmail.com";
const OUT = "e2e/.auth/practice-day.json";
const ZONE = "Australia/Melbourne";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? process.env.AUTH_URL ?? "http://localhost:3000")
  .trim()
  .replace(/\/$/, "");

function freshAlias(): string {
  const [local, domain] = BASE_EMAIL.split("@");
  return `${local}+obpracticeday-${randomBytes(3).toString("hex")}@${domain}`;
}

async function mintSignInUrl(email: string): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — run via dotenv-cli so .env.local loads.");
  const token = randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: {
      identifier: email,
      token: createHash("sha256").update(`${token}${secret}`).digest("hex"),
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const params = new URLSearchParams({ callbackUrl: `${BASE}/`, token, email });
  return `${BASE}/api/auth/callback/nodemailer?${params}`;
}

/** Laps around a target best, so each run has a real spread rather than five identical numbers. */
const lapsAround = (best: number): number[] =>
  [best, best + 0.08, best + 0.13, best + 0.19, best + 0.24, best + 0.41, best + 0.9];

const avgTop5 = (laps: number[]) =>
  [...laps].sort((a, b) => a - b).slice(0, 5).reduce((s, n) => s + n, 0) / 5;

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");

  const email = freshAlias();
  await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });
  const user = await prisma.user.create({
    data: { email, name: "Practice Day" },
    select: { id: true },
  });

  const track = await prisma.track.create({
    data: { userId: user.id, name: "Kilsyth Raceway" },
    select: { id: true, name: true },
  });

  const car = await prisma.car.create({
    data: { userId: user.id, name: "TC01", carClass: "touring" },
    select: { id: true, name: true },
  });

  const today = new Date();
  const event = await prisma.event.create({
    data: {
      userId: user.id,
      name: "Club Round 5",
      trackId: track.id,
      trackNameSnapshot: track.name,
      startDate: today,
      endDate: today,
    },
    select: { id: true, name: true },
  });

  /*
   * Five practice sessions. Run 3 holds the day's best lap, so the Pace row has a run to point
   * at that is neither the first nor the last — the position has to be carried, not guessed from
   * "latest". Run 5 changes the front sway bar, so the Last-change row has something to judge.
   */
  const plan = [
    { minutesAgo: 64, best: 15.412, rating: 5, sway: "1.4" },
    { minutesAgo: 50, best: 15.208, rating: 6, sway: "1.4" },
    { minutesAgo: 38, best: 15.041, rating: 8, sway: "1.4" },
    { minutesAgo: 24, best: 15.164, rating: 7, sway: "1.4" },
    { minutesAgo: 11, best: 15.099, rating: 7, sway: "1.5" },
  ];

  const runIds: string[] = [];
  for (const [i, step] of plan.entries()) {
    const at = new Date(Date.now() - step.minutesAgo * 60_000);
    const setup: Prisma.InputJsonObject = {
      camber_front: -2,
      camber_rear: -1.5,
      front_sway_bar: step.sway,
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
        eventId: event.id,
        setupSnapshotId: snapshot.id,
        // THE POINT OF THE FIXTURE: session type and nothing else. No code, no label.
        sessionType: "RACE_MEETING",
        meetingSessionType: "PRACTICE",
        meetingSessionCode: null,
        sessionLabel: null,
        lapTimes: laps,
        bestLapSeconds: Math.min(...laps),
        avgTop5LapSeconds: avgTop5(laps),
        carRating: step.rating,
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
    console.log(`  Run ${i + 1}: best ${Math.min(...laps).toFixed(3)}  ${run.id}`);
  }

  const signInUrl = await mintSignInUrl(email);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ signInUrl, email, runIds, eventId: event.id }, null, 2));

  console.log(`\nAccount:  ${email}`);
  console.log(`Event:    ${event.name} at ${track.name}`);
  console.log(`Wrote:    ${OUT}\n`);
  console.log(signInUrl + "\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
