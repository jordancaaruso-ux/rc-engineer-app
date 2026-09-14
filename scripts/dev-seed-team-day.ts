/**
 * dev-seed-team-day.ts — DEV ONLY, throwaway. A team on one club day, so the Analysis "Your team"
 * card can be driven with every tier of its order on screen at once (2026-09-14 ruling: teammates
 * out with you today first, then teammates out today elsewhere, then everyone newest first).
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-team-day.ts            # create, print the one-tap sign-in URLs
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-seed-team-day.ts --cleanup  # delete exactly what it created
 *
 * What it plants, all under `+obteamday-` aliases and one team named "Team Day Fixture":
 *   viewer   — Jordan Fixture: ran Kilsyth 30 min ago            (so "here" = Kilsyth today)
 *   teammate — Cooper Fixture: ran Kilsyth 8 min ago             (tier 1, pip lit, leads)
 *   teammate — Dane Fixture:   ran Kilsyth 70 min ago            (tier 1, pip OFF — "today", not 20 min)
 *                              + a newer UNSHARED run 2 min ago  (must stay invisible; row quotes 70 min)
 *   teammate — Marc Fixture:   ran Ironbark 5 min ago            (tier 2 — newest of all, other track)
 *   teammate — Alex Fixture:   ran Kilsyth 2 days ago            (tier 3 — same track, not today)
 *   teammate — Zoe Fixture:    never ran                         (tail)
 *   stranger — Lucas Fixture:  ran Kilsyth 3 min ago, NOT on the team, run shared
 *                              (must appear NOWHERE — the whole point of the ruling)
 *
 * Sign in as Alex for the "no run of yours today" face: nobody is "here", so the card reads
 * "out today first" with Marc, Cooper, Dane, then Jordan, then Zoe.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "@/lib/prisma";

const BASE_EMAIL = "jordancaaruso@gmail.com";
const ALIAS_TAG = "+obteamday-";
const OUT = "e2e/.auth/team-day.json";
const ZONE = "Australia/Melbourne";
const TEAM_NAME = "Team Day Fixture";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const BASE = (argValue("base") ?? "http://localhost:3000").trim().replace(/\/$/, "");

const [local, domain] = BASE_EMAIL.split("@");
const alias = (who: string) =>
  `${local}${ALIAS_TAG}${who}-${randomBytes(2).toString("hex")}@${domain}`;

const lapsAround = (best: number): number[] =>
  [best, best + 0.08, best + 0.13, best + 0.19, best + 0.24, best + 0.41, best + 0.9];
const avgTop5 = (laps: number[]) =>
  [...laps].sort((a, b) => a - b).slice(0, 5).reduce((s, n) => s + n, 0) / 5;

function guardDatabase() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase: ${dbHost}`);
  if (/ep-hidden-rice/.test(dbHost)) throw new Error("REFUSING TO RUN: that is PRODUCTION.");
}

async function cleanup() {
  guardDatabase();
  const saved = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null;
  const users = await prisma.user.findMany({
    where: { email: { contains: ALIAS_TAG } },
    select: { id: true, email: true },
  });
  // Users cascade to tracks, cars, snapshots, runs and memberships. The team does not hang off a
  // user, so it goes by the id the create wrote down (and by name, belt and braces).
  if (saved?.teamId) await prisma.team.deleteMany({ where: { id: saved.teamId } });
  await prisma.team.deleteMany({ where: { name: TEAM_NAME } });
  for (const u of users) {
    await prisma.user.delete({ where: { id: u.id } });
    if (u.email) await prisma.authAllowedEmail.deleteMany({ where: { email: u.email } });
    console.log(`  deleted ${u.email}`);
  }
  console.log(`\nRemoved ${users.length} fixture accounts.\n`);
}

async function createUser(who: string, name: string) {
  const email = alias(who);
  await prisma.authAllowedEmail.upsert({ where: { email }, update: {}, create: { email } });
  const user = await prisma.user.create({
    data: { email, name, timeZone: ZONE },
    select: { id: true, email: true },
  });
  const car = await prisma.car.create({
    data: { userId: user.id, name: "TC01", carClass: "touring" },
    select: { id: true, name: true },
  });
  return { ...user, name, car };
}

type Seeded = Awaited<ReturnType<typeof createUser>>;

async function logRun(
  driver: Seeded,
  track: { id: string; name: string },
  minutesAgo: number,
  best: number,
  opts: { shared?: boolean } = {}
) {
  const at = new Date(Date.now() - minutesAgo * 60_000);
  const snapshot = await prisma.setupSnapshot.create({
    data: {
      userId: driver.id,
      carId: driver.car.id,
      data: { camber_front: -2, camber_rear: -1.5, ride_height_front: 5, ride_height_rear: 5.5 },
    },
    select: { id: true },
  });
  const laps = lapsAround(best);
  await prisma.run.create({
    data: {
      userId: driver.id,
      carId: driver.car.id,
      carNameSnapshot: driver.car.name,
      trackId: track.id,
      trackNameSnapshot: track.name,
      setupSnapshotId: snapshot.id,
      sessionType: "TESTING",
      lapTimes: laps,
      bestLapSeconds: Math.min(...laps),
      avgTop5LapSeconds: avgTop5(laps),
      loggingComplete: true,
      loggingCompletedAt: at,
      sessionCompletedAt: at,
      createdAt: at,
      sortAt: at,
      localTimeZone: ZONE,
      shareWithTeam: opts.shared ?? true,
    },
  });
}

async function main() {
  guardDatabase();

  const viewer = await createUser("viewer", "Jordan Fixture");
  const cooper = await createUser("cooper", "Cooper Fixture");
  const dane = await createUser("dane", "Dane Fixture");
  const marc = await createUser("marc", "Marc Fixture");
  const alex = await createUser("alex", "Alex Fixture");
  const zoe = await createUser("zoe", "Zoe Fixture");
  const lucas = await createUser("lucas", "Lucas Fixture");

  const kilsyth = await prisma.track.create({
    data: { userId: viewer.id, name: "Kilsyth Raceway" },
    select: { id: true, name: true },
  });
  const ironbark = await prisma.track.create({
    data: { userId: viewer.id, name: "Ironbark Raceway" },
    select: { id: true, name: true },
  });

  const team = await prisma.team.create({ data: { name: TEAM_NAME }, select: { id: true } });
  // Joined in this order, so a two-team tie would resolve predictably — not exercised here.
  for (const member of [viewer, cooper, dane, marc, alex, zoe]) {
    await prisma.teamMembership.create({ data: { teamId: team.id, userId: member.id } });
  }

  await logRun(viewer, kilsyth, 30, 15.21);
  await logRun(cooper, kilsyth, 8, 15.02);
  await logRun(dane, kilsyth, 70, 15.34);
  await logRun(dane, kilsyth, 2, 14.9, { shared: false }); // hidden: never shows, never reorders
  await logRun(marc, ironbark, 5, 17.11);
  await logRun(alex, kilsyth, 2 * 24 * 60 + 15, 15.5);
  await logRun(lucas, kilsyth, 3, 14.8); // stranger — must not surface

  const signIn = (email: string | null) =>
    `${BASE}/api/auth/dev-signin?email=${encodeURIComponent(email ?? "")}&to=${encodeURIComponent("/analysis")}`;

  const out = {
    teamId: team.id,
    viewer: { email: viewer.email, url: signIn(viewer.email) },
    alex: { email: alex.email, url: signIn(alex.email) },
    lucas: { email: lucas.email, url: signIn(lucas.email) },
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log(`\nTeam:   ${TEAM_NAME} (${team.id})`);
  console.log(`Viewer: ${out.viewer.url}`);
  console.log(`Alex:   ${out.alex.url}`);
  console.log(`Lucas:  ${out.lucas.url}`);
  console.log(`Wrote:  ${OUT}\n`);
}

(args.includes("--cleanup") ? cleanup() : main())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
