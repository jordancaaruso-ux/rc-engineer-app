/**
 * Write field stats for every imported timing session that has none.
 *
 *   npm run db:backfill-field-stats            # whatever .env.local points at (scratch-dev)
 *   npm run db:backfill-field-stats -- --dry   # count only
 *
 * `fieldStatsJson` (every entrant's best / top 5 / top 10, your rank) has been written on
 * import since it existed, but sessions imported before that — and single-driver sheets that
 * later grew a field on re-import — carry null. The Engineer's "vs field" figures read the
 * stored stats only (fieldPaceLoad.ts), so this fills the gap once from `parsedPayload`,
 * exactly as the importer does (`computeImportedSessionFieldStatsFromPayload`). Idempotent:
 * a session with stats is left alone.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { computeImportedSessionFieldStatsFromPayload } from "@/lib/lapImport/computeImportedSessionFieldStats";

const DRY = process.argv.includes("--dry");
const BATCH = 50;

async function main() {
  const total = await prisma.importedLapTimeSession.count({ where: { fieldStatsJson: { equals: Prisma.DbNull } } });
  console.log(`${total} imported sessions without field stats${DRY ? " (dry run)" : ""}`);
  let done = 0;
  let written = 0;
  let single = 0;
  let empty = 0;
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.importedLapTimeSession.findMany({
      where: { fieldStatsJson: { equals: Prisma.DbNull } },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, parsedPayload: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      done++;
      const stats = computeImportedSessionFieldStatsFromPayload(row.parsedPayload);
      if (!stats) {
        empty++;
        continue;
      }
      if (stats.driverCount < 2) single++;
      else written++;
      if (!DRY) {
        await prisma.importedLapTimeSession.update({
          where: { id: row.id },
          data: { fieldStatsJson: stats as unknown as Prisma.InputJsonValue },
        });
      }
    }
    cursor = rows[rows.length - 1].id;
    process.stdout.write(`  ${done}/${total}\r`);
  }
  console.log(`\n${done} read · ${written} with a field of 2+ · ${single} single-driver · ${empty} no entrant data${DRY ? " · nothing written" : ""}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
