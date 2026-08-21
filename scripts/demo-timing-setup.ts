/**
 * demo-timing-setup.ts — put the demo track and driver name on a local account, so the
 * Log-a-run wizard's URL Auto tab finds the invented Ironbark Raceway session.
 *
 *   npm run demo:timing:setup                      # defaults to the demo account
 *   npm run demo:timing:setup -- --email=me@x.com  # any local account
 *   npm run demo:timing:setup -- --reset           # forget past imports, for a clean re-take
 *
 * The driver's name comes from `DEMO_TIMING_DRIVER_NAME` (default "Nic Swole") and is written
 * to BOTH the LiveRC-name setting and the app's my-name setting, so the imported field and the
 * saved run's lap column agree. Change it there, not here.
 *
 * Pairs with `DEMO_TIMING_SITE=1` in `.env.local` (see src/lib/lapUrlParsers/demoTimingSite.ts).
 * Refuses to touch production outright: this writes a track that does not exist.
 */
import { prisma } from "@/lib/prisma";
import { APP_SETTING_KEYS, getMyNameSetting, setUserSetting } from "@/lib/appSettings";
import {
  DEMO_DRIVER_NAME,
  DEMO_TIMING_HOST,
  DEMO_TIMING_ORIGIN,
  DEMO_TRACK_NAME,
} from "@/lib/lapUrlParsers/demoTimingSite";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const reset = args.includes("--reset");

/** Neon branch that serves real paying users. Named so the refusal cannot be argued with. */
const PRODUCTION_DB_HOST_FRAGMENT = "ep-hidden-rice";

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase host: ${dbHost}`);
  if (dbHost.includes(PRODUCTION_DB_HOST_FRAGMENT)) {
    console.error("Refusing to run: that is the production database. This seeds a fake race track.");
    process.exit(1);
  }

  const email = (argValue("email") ?? process.env.DEMO_USER_EMAIL ?? "demo@jrcdynamics.com").trim();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    console.error(`No account found for ${email}. Pass --email=<an account on this database>.`);
    process.exit(1);
  }
  console.log(`Account: ${user.email} (${user.name ?? "no name"})\n`);

  // ── The track the wizard points discovery at ────────────────────────────────
  const existing = await prisma.track.findFirst({
    where: { userId: user.id, name: DEMO_TRACK_NAME },
    select: { id: true },
  });
  const track = existing
    ? await prisma.track.update({
        where: { id: existing.id },
        data: { liveRcUrl: DEMO_TIMING_ORIGIN, speedhiveUrl: null, location: "Demo" },
        select: { id: true },
      })
    : await prisma.track.create({
        data: {
          userId: user.id,
          name: DEMO_TRACK_NAME,
          location: "Demo",
          liveRcUrl: DEMO_TIMING_ORIGIN,
        },
        select: { id: true },
      });
  console.log(`${existing ? "Updated" : "Created"} track "${DEMO_TRACK_NAME}" (${track.id})`);
  console.log(`  LiveRC: ${DEMO_TIMING_ORIGIN}`);

  // ── Who to look for in the results ──────────────────────────────────────────
  await setUserSetting(user.id, APP_SETTING_KEYS.liveRcDriverName, DEMO_DRIVER_NAME);
  // Cleared, not set: discovery resolves the driver id off the demo field on first scan, and a
  // leftover id from a real club would never appear there — the scan would silently find nothing.
  await setUserSetting(user.id, APP_SETTING_KEYS.liveRcDriverId, null);
  console.log(`Name on LiveRC: "${DEMO_DRIVER_NAME}" (driver id cleared, resolves on first scan)`);

  // The saved run labels the driver's own lap column from `myName`. Left alone, a demo field
  // full of one name and a lap column carrying another both end up on screen in the same shot.
  const previousMyName = await getMyNameSetting(user.id);
  if (previousMyName !== DEMO_DRIVER_NAME) {
    await setUserSetting(user.id, APP_SETTING_KEYS.myName, DEMO_DRIVER_NAME);
    console.log(
      `Your name in the app: "${previousMyName ?? "(unset)"}" -> "${DEMO_DRIVER_NAME}" (so the lap column matches the field)`,
    );
  }

  // ── Re-take support ─────────────────────────────────────────────────────────
  const importedWhere = { userId: user.id, sourceUrl: { contains: DEMO_TIMING_HOST } };
  const importedCount = await prisma.importedLapTimeSession.count({ where: importedWhere });
  if (reset) {
    // The picker marks a session "already imported" once it has been taken, which is right
    // for a driver and wrong for a second take. Runs are left alone — delete those in the app.
    const { count } = await prisma.importedLapTimeSession.deleteMany({ where: importedWhere });
    console.log(`Reset: deleted ${count} previous demo import(s). Runs are untouched.`);
  } else if (importedCount > 0) {
    console.log(
      `\nNote: ${importedCount} demo session(s) already imported — the picker will show them as` +
        ` already taken. Re-run with --reset for a clean take.`,
    );
  }

  console.log(`\nNext:`);
  console.log(`  1. DEMO_TIMING_SITE=1 in .env.local`);
  console.log(`  2. restart the dev server`);
  console.log(`  3. Log a run -> pick "${DEMO_TRACK_NAME}" -> Lap times -> URL Auto\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
