/**
 * One-time migration helper: collapse duplicate global Event rows that share the same
 * track + normalized LiveRC results hub URL. Picks the keeper with the most runs,
 * then participations, then earliest start date; repoints runs/sessions/participations
 * from losers onto the keeper, then deletes the losers.
 *
 * SAFE BY DEFAULT: dry-run prints the plan and changes nothing.
 *   Dry-run: npx tsx scripts/dedupe-events.ts
 *   Apply:   npx tsx scripts/dedupe-events.ts --apply
 *
 * Run against a Neon branch first. After applying in every environment, add:
 *   CREATE UNIQUE INDEX "Event_trackId_resultsSourceUrl_key"
 *   ON "Event" ("trackId", "resultsSourceUrl")
 *   WHERE "resultsSourceUrl" IS NOT NULL;
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { normalizeLiveRcEventHubUrl } from "@/lib/lapWatch/resolveEventFromLiveRcMeeting";
import { mergeEvents } from "@/lib/events/mergeEvents";

const APPLY = process.argv.includes("--apply");

type EventRow = {
  id: string;
  name: string;
  trackId: string | null;
  startDate: Date;
  resultsSourceUrl: string;
  runCount: number;
  participationCount: number;
};

function normalizedResultsUrl(url: string): string {
  return normalizeLiveRcEventHubUrl(url) ?? url.trim();
}

async function loadRows(): Promise<EventRow[]> {
  const rows = await prisma.event.findMany({
    where: { resultsSourceUrl: { not: null } },
    select: {
      id: true,
      name: true,
      trackId: true,
      startDate: true,
      resultsSourceUrl: true,
      _count: { select: { runs: true, participations: true } },
    },
  });
  return rows
    .filter((r): r is typeof r & { resultsSourceUrl: string } => Boolean(r.resultsSourceUrl?.trim()))
    .map((r) => ({
      id: r.id,
      name: r.name,
      trackId: r.trackId,
      startDate: r.startDate,
      resultsSourceUrl: r.resultsSourceUrl,
      runCount: r._count.runs,
      participationCount: r._count.participations,
    }));
}

function pickKeeper(group: EventRow[]): EventRow {
  return [...group].sort((a, b) => {
    if (b.runCount !== a.runCount) return b.runCount - a.runCount;
    if (b.participationCount !== a.participationCount) {
      return b.participationCount - a.participationCount;
    }
    return a.startDate.getTime() - b.startDate.getTime();
  })[0]!;
}

async function main(): Promise<void> {
  const rows = await loadRows();
  const groups = new Map<string, EventRow[]>();

  for (const row of rows) {
    const key = `${row.trackId}::${normalizedResultsUrl(row.resultsSourceUrl)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const duplicateGroups = [...groups.values()].filter((g) => g.length > 1);
  if (duplicateGroups.length === 0) {
    console.log("No duplicate track + LiveRC results URL groups found.");
    return;
  }

  console.log(`Found ${duplicateGroups.length} duplicate group(s):\n`);
  let mergeCount = 0;

  for (const group of duplicateGroups) {
    const keeper = pickKeeper(group);
    const losers = group.filter((r) => r.id !== keeper.id);
    const key = `${keeper.trackId}::${normalizedResultsUrl(keeper.resultsSourceUrl)}`;
    console.log(`Group ${key}`);
    console.log(`  KEEP  ${keeper.id}  "${keeper.name}"  runs=${keeper.runCount}  parts=${keeper.participationCount}`);
    for (const loser of losers) {
      console.log(
        `  MERGE ${loser.id}  "${loser.name}"  runs=${loser.runCount}  parts=${loser.participationCount}`
      );
      if (APPLY) {
        await mergeEvents({ winnerId: keeper.id, loserId: loser.id });
      }
      mergeCount += 1;
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(`Dry run: would merge ${mergeCount} loser event(s). Re-run with --apply to execute.`);
    console.log(
      "\nAfter applying in all environments, add the partial unique index (see script header)."
    );
    return;
  }

  console.log(`Applied ${mergeCount} merge(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
