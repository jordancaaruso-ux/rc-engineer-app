/**
 * dev-dump-dashboard-model.ts — DEV ONLY, throwaway. Dump the dashboard model for one account
 * so a layout can be mocked against REAL rows instead of invented ones.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-dump-dashboard-model.ts --email=someone@example.com
 *
 * Lists the accounts with the most runs when no --email is given.
 */
import { prisma } from "@/lib/prisma";
import { loadDashboardHomeModel } from "@/lib/dashboardServer";

const args = process.argv.slice(2);
const argValue = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

async function main() {
  const email = argValue("email");
  const tz = argValue("tz") ?? "Australia/Brisbane";

  if (!email) {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, _count: { select: { runs: true } } },
    });
    const ranked = users
      .map((u) => ({ email: u.email, runs: u._count.runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 12);
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }

  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`no user ${email}`);

  const model = await loadDashboardHomeModel(user.id, tz);
  console.log(
    JSON.stringify(
      {
        featuredEvent: model.featuredEvent,
        hasRunToday: model.hasRunToday,
        todayRunCount: model.todayRunCount,
        heroPace: model.heroPace,
        summary: model.summary,
        records: model.records,
        recentRun: model.recentRun
          ? {
              id: model.recentRun.id,
              carName: model.recentRun.carName,
              trackName: (model.recentRun as Record<string, unknown>).trackName ?? null,
              label: (model.recentRun as Record<string, unknown>).label ?? null,
              bestLap: (model.recentRun as Record<string, unknown>).bestLapSeconds ?? null,
            }
          : null,
        todayVerdict: model.todayVerdict,
        todayContext: model.todayContext,
        todayStripCount: model.todayStrip.length,
        thingsToTry: model.thingsToTry,
        thingsToDo: model.thingsToDo,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
