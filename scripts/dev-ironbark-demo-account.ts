/**
 * dev-ironbark-demo-account.ts — DEV ONLY. Stand up a throwaway account whose only track is the
 * invented Ironbark Raceway, so "Import your last runs" can be driven over a range of days
 * without a real club, a real driver, or Jordan's own 178 runs in the way.
 *
 * The site it reads is `src/lib/lapUrlParsers/demoTimingSite.ts` (practice on days 1, 2, 6 and 7
 * back, a race meeting today, and quiet days between). Needs DEMO_TIMING_SITE=1 in this process
 * AND in the dev server the account is then used on.
 *
 *   npx dotenv-cli -e .env.local -- cross-env DEMO_TIMING_SITE=1 node --conditions=react-server \
 *     --import tsx scripts/dev-ironbark-demo-account.ts [--reset] [--seed-day=7]
 *
 * `--reset` deletes the account's runs and imports so the whole range is importable again.
 * `--seed-day=N` pre-imports the practice day N days back. Off by default, and it only works
 * from a real request: filing ends in `revalidatePath`, which throws "static generation store
 * missing" in a bare script. Seed by importing a day in the app instead — same code, and it is
 * the thing being tested anyway.
 */
import { prisma } from "@/lib/prisma";
import { APP_SETTING_KEYS, setUserSetting } from "@/lib/appSettings";
import {
  DEMO_DRIVER_NAME,
  DEMO_TIMING_HOST,
  DEMO_TIMING_ORIGIN,
  DEMO_TRACK_NAME,
  isDemoTimingSiteEnabled,
} from "@/lib/lapUrlParsers/demoTimingSite";
import { getMyDay, loadGetMyDayTrack, logChosenForDay } from "@/lib/sweep/getMyDay";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const reset = args.includes("--reset");
const seedDayRaw = argValue("seed-day") ?? "none";

const EMAIL = (argValue("email") ?? "ironbark.demo@jrcdynamics.com").toLowerCase();
const DISPLAY_NAME = DEMO_DRIVER_NAME;
const TIME_ZONE = "Australia/Sydney";
/** Neon branch that serves real paying users. Named so the refusal cannot be argued with. */
const PRODUCTION_DB_HOST_FRAGMENT = "ep-hidden-rice";

function localYmdDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`\nDatabase host: ${dbHost}`);
  if (dbHost.includes(PRODUCTION_DB_HOST_FRAGMENT)) {
    console.error("Refusing to run: that is the production database. This seeds a fake race track.");
    process.exit(1);
  }
  if (!isDemoTimingSiteEnabled()) {
    console.error("DEMO_TIMING_SITE=1 is not set in this process — the fake site would not answer.");
    process.exit(1);
  }

  const user =
    (await prisma.user.findFirst({ where: { email: EMAIL }, select: { id: true } })) ??
    (await prisma.user.create({
      data: { email: EMAIL, name: DISPLAY_NAME, emailVerified: new Date(), timeZone: TIME_ZONE },
      select: { id: true },
    }));
  await prisma.user.update({ where: { id: user.id }, data: { name: DISPLAY_NAME, timeZone: TIME_ZONE } });
  console.log(`Account: ${EMAIL} (${user.id})`);

  // Entitled, so the paid door (BILLING_ENFORCED=1 on his dev server) lets the sheet through.
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      stripeSubscriptionId: `sub_devstate_${user.id.slice(-8)}`,
      stripeCustomerId: `cus_devstate_${user.id.slice(-8)}`,
      status: "active",
      tier: "pro",
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
    update: { status: "active", tier: "pro", currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) },
  });
  console.log("Plan: Pro (fake Stripe ids, scratch-dev only)");

  const existingTrack = await prisma.track.findFirst({
    where: { userId: user.id, name: DEMO_TRACK_NAME },
    select: { id: true },
  });
  const track = existingTrack
    ? await prisma.track.update({
        where: { id: existingTrack.id },
        data: { liveRcUrl: DEMO_TIMING_ORIGIN, speedhiveUrl: null, location: "Demo", timeZone: TIME_ZONE },
        select: { id: true },
      })
    : await prisma.track.create({
        data: {
          userId: user.id,
          name: DEMO_TRACK_NAME,
          location: "Demo",
          liveRcUrl: DEMO_TIMING_ORIGIN,
          timeZone: TIME_ZONE,
        },
        select: { id: true },
      });
  console.log(`Track: ${DEMO_TRACK_NAME} (${track.id}) -> ${DEMO_TIMING_ORIGIN}`);

  const car =
    (await prisma.car.findFirst({ where: { userId: user.id }, select: { id: true, name: true } })) ??
    (await prisma.car.create({
      data: { userId: user.id, name: "Ironbark buggy", chassis: "B7", carClass: "buggy_2wd~electric" },
      select: { id: true, name: true },
    }));
  console.log(`Car: ${car.name} (${car.id})`);

  // Who to look for in the invented results. The driver id is cleared, not set: it resolves off
  // the demo field on the first scan, and a leftover id would never appear there.
  await setUserSetting(user.id, APP_SETTING_KEYS.liveRcDriverName, DEMO_DRIVER_NAME);
  await setUserSetting(user.id, APP_SETTING_KEYS.liveRcDriverId, null);
  await setUserSetting(user.id, APP_SETTING_KEYS.myName, DEMO_DRIVER_NAME);
  console.log(`Name on LiveRC: "${DEMO_DRIVER_NAME}"`);

  if (reset) {
    const runs = await prisma.run.deleteMany({ where: { userId: user.id } });
    const imports = await prisma.importedLapTimeSession.deleteMany({
      where: { userId: user.id, sourceUrl: { contains: DEMO_TIMING_HOST } },
    });
    console.log(`Reset: deleted ${runs.count} run(s) and ${imports.count} import(s).`);
  }

  if (seedDayRaw !== "none") {
    const ymd = localYmdDaysAgo(Number(seedDayRaw));
    const loaded = await loadGetMyDayTrack(track.id);
    if (!loaded) throw new Error("track vanished");
    const first = await getMyDay({ userId: user.id, track: loaded, ymd });
    console.log(
      `Seeded ${ymd}: found ${first.found}, joined ${first.joined}, not logged ${first.pending.length}, needs car ${first.needsCar}`,
    );
    // The demo account ticks everything, the way a driver logging the whole day would.
    if (first.pending.length > 0) {
      const after = await logChosenForDay({
        userId: user.id,
        track: loaded,
        ymd,
        keep: first.pending.map((r) => r.id),
        decline: [],
        carId: car.id,
      });
      console.log(`  logged with ${car.name}: ${after.logged}, still not logged ${after.pending.length}`);
    }
  }

  const runCount = await prisma.run.count({ where: { userId: user.id } });
  console.log(`\nRuns on the account: ${runCount}`);
  console.log(`Sign in:  http://192.168.50.91:3000/api/auth/dev-signin?email=${encodeURIComponent(EMAIL)}&to=/`);
  console.log(`(the dev server must be running with DEMO_TIMING_SITE=1)\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
