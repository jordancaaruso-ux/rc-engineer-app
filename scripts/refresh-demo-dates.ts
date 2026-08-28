/**
 * refresh-demo-dates.ts — slide the demo season forward so it never reads as abandoned.
 *
 *   npm run demo:refresh -- --dry-run                    # report the drift, write nothing
 *   npm run demo:refresh -- --confirm-host=<db host>     # apply it
 *   npm run demo:refresh -- --confirm-host=... --lag-days=2
 *
 * Why this exists: `seed-demo-account.ts` copies the founder's season with its real dates, and
 * the app reads almost everything through 30-day windows. Left alone, the demo silently becomes
 * a driver who hasn't raced in months — measured on production 2026-08-25, where the public
 * demo's dashboard was showing `Runs 30d 0 · Active days 0 · Best streak 0d` to every visitor.
 * Re-seeding cannot fix that (the newest row it can copy is the founder's newest real run), so
 * the season has to move instead. See `src/lib/demo/demoDateShift.ts`.
 *
 * Non-destructive: arithmetic UPDATEs over rows the demo account owns, nothing deleted, nothing
 * copied, no other user's rows in scope on any table. Idempotent and self-correcting — running
 * it twice in a day does nothing the second time, and a month of missed runs is caught up in
 * one shift. `/api/cron/refresh-demo` runs exactly this on a schedule; this script is the
 * founder's hand control and the way to test it against scratch-dev.
 */
import { refreshDemoSeasonDates } from "@/lib/demo/applyDemoDateShift";
import { demoCatalogUserId } from "@/lib/demo/demoAccess";
import {
  DEMO_RECENCY_LAG_DAYS,
  computeDemoShiftMs,
  shouldApplyDemoShift,
} from "@/lib/demo/demoDateShift";
import { prisma } from "@/lib/prisma";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const dryRun = args.includes("--dry-run");
const lagDays = Math.max(
  0,
  Number(argValue("lag-days") ?? DEMO_RECENCY_LAG_DAYS) || DEMO_RECENCY_LAG_DAYS,
);

async function main() {
  const dbHost = process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
  const userId = demoCatalogUserId();
  console.log(`\nDatabase host: ${dbHost}`);
  console.log(`Demo user:     ${userId}`);

  const newest = await prisma.run.findFirst({
    where: { userId },
    orderBy: { sortAt: "desc" },
    select: { sortAt: true },
  });
  if (!newest) {
    console.log("\nNo demo runs found — nothing to move. (Seed the demo first.)");
    return;
  }

  const now = new Date();
  const deltaMs = computeDemoShiftMs({ newestRunAt: newest.sortAt, now, lagDays });
  const deltaDays = Math.round((deltaMs / 86_400_000) * 10) / 10;
  const staleDays = Math.round(((now.getTime() - newest.sortAt.getTime()) / 86_400_000) * 10) / 10;

  console.log(`\nNewest demo run: ${newest.sortAt.toISOString().slice(0, 10)} (${staleDays} days ago)`);
  console.log(`Target:          ${lagDays} day(s) ago`);
  console.log(`Drift to close:  ${deltaDays >= 0 ? "+" : ""}${deltaDays} days`);

  if (!shouldApplyDemoShift(deltaMs)) {
    console.log("\nWithin tolerance — nothing to do.");
    return;
  }
  if (dryRun) {
    console.log("\n--dry-run: no rows written.");
    return;
  }
  if (argValue("confirm-host") !== dbHost) {
    console.error(
      `\nRefusing to write: pass --confirm-host=${dbHost} to confirm you mean THIS database.`,
    );
    process.exitCode = 1;
    return;
  }

  const result = await refreshDemoSeasonDates({ now, lagDays });
  console.log(`\nMoved ${result.deltaDays >= 0 ? "+" : ""}${result.deltaDays} days.`);
  console.log(`Newest run: ${result.newestRunBefore?.slice(0, 10)} → ${result.newestRunAfter?.slice(0, 10)}`);
  for (const [table, rows] of Object.entries(result.rowsByTable)) {
    if (rows > 0) console.log(`  ${table.padEnd(30)} ${rows} rows`);
  }
  console.log(
    "\nCached pages hold for up to 30s (staleTimes.dynamic) — the cron route revalidates; " +
      "after a hand run, give the demo a moment before judging it.",
  );
}

main()
  .catch((err) => {
    console.error(`\n${err instanceof Error ? err.stack ?? err.message : err}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
