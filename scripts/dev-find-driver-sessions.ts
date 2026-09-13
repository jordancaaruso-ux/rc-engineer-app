/**
 * Find the most recent sessions for a driver, by name.
 *
 * A driver name can land in the data three different ways, so all three are checked:
 *   1. As an app User (they have an account) -> their own Run rows.
 *   2. As a RunImportedLapSet on somebody's Run (their timing row was imported alongside,
 *      e.g. as a teammate or a competitor in the same heat). `isPrimaryUser` says which.
 *   3. As a driver inside an ImportedLapTimeSession `parsedPayload` that was never saved
 *      onto a Run. This one is a JSON text scan, so it is opt-out via --no-payload-scan.
 *
 * Usage (read-only; pick the env file that points at the database you mean):
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/dev-find-driver-sessions.ts "Lucas Urbain"
 *   ... "Lucas Urbain" 20 --no-payload-scan
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const skipPayloadScan = args.includes("--no-payload-scan");
const positional = args.filter((a) => !a.startsWith("--"));
const NAME = positional[0] ?? "Lucas Urbain";
const LIMIT = Number(positional[1] ?? 20);
const NORM = NAME.trim().toLowerCase();

function fmt(d: Date | null | undefined): string {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) + "Z" : "-";
}
function secs(n: number | null | undefined): string {
  return typeof n === "number" ? n.toFixed(3) : "-";
}

async function whichDatabase() {
  const rows = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const url = process.env.DATABASE_URL ?? "";
  const host = url.match(/@([^/:]+)/)?.[1] ?? "unknown";
  console.log(`database: ${rows[0]?.db ?? "?"} @ ${host}`);
  console.log(`driver:   "${NAME}" (normalized "${NORM}")\n`);
}

async function asUser() {
  console.log("== 1. matching app users ==");
  const users = await prisma.user.findMany({
    where: { OR: [{ name: { contains: NAME, mode: "insensitive" } }, { email: { contains: NORM, mode: "insensitive" } }] },
    select: { id: true, name: true, email: true, createdAt: true, _count: { select: { runs: true } } },
  });
  if (users.length === 0) {
    console.log("(none)\n");
    return;
  }
  for (const u of users) {
    console.log(`user ${u.id} | ${u.name ?? "-"} | ${u.email ?? "-"} | runs=${u._count.runs}`);
    const runs = await prisma.run.findMany({
      where: { userId: u.id },
      orderBy: { sortAt: "desc" },
      take: LIMIT,
      select: {
        id: true, sortAt: true, sessionCompletedAt: true, createdAt: true,
        sessionType: true, sessionLabel: true, raceClass: true,
        trackNameSnapshot: true, carNameSnapshot: true,
        bestLapSeconds: true, avgTop5LapSeconds: true,
      },
    });
    for (const r of runs) {
      console.log(
        `  ${fmt(r.sortAt)} | ${r.id} | ${r.sessionType}${r.sessionLabel ? ` "${r.sessionLabel}"` : ""}` +
          ` | class=${r.raceClass ?? "-"}` +
          ` | ${r.trackNameSnapshot ?? "-"} | ${r.carNameSnapshot ?? "-"}` +
          ` | best=${secs(r.bestLapSeconds)} top5=${secs(r.avgTop5LapSeconds)}` +
          ` | completed=${fmt(r.sessionCompletedAt)} created=${fmt(r.createdAt)}`,
      );
    }
    console.log("");
  }
}

async function asImportedLapSet() {
  console.log("== 2. imported lap sets carrying that driver name ==");
  const sets = await prisma.runImportedLapSet.findMany({
    where: { normalizedName: { contains: NORM } },
    orderBy: [{ sessionCompletedAt: "desc" }, { createdAt: "desc" }],
    take: LIMIT,
    select: {
      id: true, driverName: true, isPrimaryUser: true, sourceUrl: true,
      sessionCompletedAt: true, createdAt: true,
      _count: { select: { laps: true } },
      run: {
        select: {
          id: true, sortAt: true, sessionType: true, sessionLabel: true,
          trackNameSnapshot: true, user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  if (sets.length === 0) {
    console.log("(none)\n");
    return;
  }
  for (const s of sets) {
    console.log(
      `${fmt(s.sessionCompletedAt ?? s.createdAt)} | "${s.driverName}"` +
        ` | primary=${s.isPrimaryUser} | laps=${s._count.laps}` +
        ` | run=${s.run.id} (${s.run.sessionType}${s.run.sessionLabel ? ` "${s.run.sessionLabel}"` : ""}` +
        ` @ ${s.run.trackNameSnapshot ?? "-"})` +
        ` | run owner=${s.run.user.email ?? s.run.user.id}` +
        ` | ${s.sourceUrl ?? "-"}`,
    );
  }
  console.log("");
}

async function asImportedSessionPayload() {
  console.log("== 3. imported timing sessions whose payload names that driver ==");
  if (skipPayloadScan) {
    console.log("(skipped: --no-payload-scan)\n");
    return;
  }
  const rows = await prisma.$queryRaw<
    Array<{ id: string; sourceUrl: string; parserId: string; sessionCompletedAt: Date | null; createdAt: Date; linkedRunId: string | null; ownerEmail: string | null }>
  >`
    SELECT s.id, s."sourceUrl", s."parserId", s."sessionCompletedAt", s."createdAt", s."linkedRunId", u.email AS "ownerEmail"
    FROM "ImportedLapTimeSession" s
    JOIN "User" u ON u.id = s."userId"
    WHERE s."parsedPayload"::text ILIKE ${"%" + NAME + "%"}
    ORDER BY COALESCE(s."sessionCompletedAt", s."createdAt") DESC
    LIMIT ${LIMIT}
  `;
  if (rows.length === 0) {
    console.log("(none)\n");
    return;
  }
  for (const r of rows) {
    console.log(
      `${fmt(r.sessionCompletedAt ?? r.createdAt)} | session=${r.id} | ${r.parserId}` +
        ` | linkedRun=${r.linkedRunId ?? "-"} | imported by=${r.ownerEmail ?? "-"}` +
        ` | ${r.sourceUrl}`,
    );
  }
  console.log("");
}

async function main() {
  await whichDatabase();
  await asUser();
  await asImportedLapSet();
  await asImportedSessionPayload();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
