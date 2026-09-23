/**
 * Give every already-imported MYLAPS practice run its chip — whose it was.
 *
 * A MYLAPS practice run was imported from its laps feed, which names nobody: the "driver" it
 * carried was the run's start time. So the library could only call it "Run 5" (founder call,
 * 2026-09-23: "a run should never just say run x — a name, the transponder number or whatever
 * name Speedhive gives"). The import now asks the practice API for the visit's chip, its owner's
 * label and the location's name; this fills the same three in for rows imported before that.
 *
 * Idempotent. Only touches Speedhive practice rows whose stored hint has no transponder yet, and
 * only writes what the API actually returned. One request per practice visit (a chip's day at a
 * location), however many runs or accounts share it.
 *
 *   npm run laps:backfill-speedhive-chips              # dry run, prints what it would write
 *   npm run laps:backfill-speedhive-chips -- --apply
 *   npm run laps:backfill-speedhive-chips -- --apply --limit 20
 *
 * A pause between requests: this is MYLAPS's API, and there is no hurry on a one-off repair.
 */

import { PrismaClient } from "@prisma/client";
import { timingUserAgent } from "../src/lib/http/timingUserAgent";
import { parseSpeedhivePracticeActivityRef } from "../src/lib/speedhive/speedhivePracticeUrl";
import { normalizeSpeedhiveTransponderNumber } from "../src/lib/speedhive/speedhiveTransponder";

const PAUSE_MS = 500;
const API = "https://practice-api.speedhive.com";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.POSITIVE_INFINITY;

type Chip = { transponder: string | null; label: string | null; location: string | null };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchChip(activityId: number): Promise<Chip | null> {
  try {
    const res = await fetch(`${API}/api/v1/training/activities/${activityId}`, {
      headers: { Accept: "application/json", Origin: "https://sporthive.com", "User-Agent": timingUserAgent() },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      chipCode?: string;
      chipLabel?: string;
      location?: { name?: string };
    };
    return {
      transponder: data.chipCode ? normalizeSpeedhiveTransponderNumber(data.chipCode) : null,
      label: data.chipLabel?.trim() || null,
      location: data.location?.name?.trim() || null,
    };
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const host = (process.env.DATABASE_URL ?? "").replace(/^[^@]*@/, "").split("/")[0];
    console.log(`database: ${host}`);

    const rows = await prisma.$queryRawUnsafe<{ id: string; sourceUrl: string }[]>(
      `select id, "sourceUrl"
         from "ImportedLapTimeSession"
        where "sourceUrl" like '%speedhive%'
          and "sourceUrl" like '%/practice/%'
          and coalesce("parsedPayload"->'sessionHint'->>'practiceTransponder', '') = ''
        order by "createdAt" desc`
    );
    console.log(`${rows.length} MYLAPS practice run(s) with no chip on file.`);
    if (!apply) console.log("(dry run — pass --apply to write)");

    const chipByActivity = new Map<number, Chip | null>();
    let named = 0;
    let missed = 0;
    let done = 0;

    for (const row of rows) {
      if (done >= limit) break;
      done += 1;

      const ref = parseSpeedhivePracticeActivityRef(row.sourceUrl);
      if (!ref) {
        missed += 1;
        console.log(`  -  ${row.sourceUrl} → not a practice run link`);
        continue;
      }
      let chip = chipByActivity.get(ref.activityId);
      if (chip === undefined) {
        chip = await fetchChip(ref.activityId);
        chipByActivity.set(ref.activityId, chip);
        await sleep(PAUSE_MS);
      }
      if (!chip?.transponder) {
        missed += 1;
        console.log(`  -  ${row.sourceUrl} → no chip returned`);
        continue;
      }

      named += 1;
      console.log(`  ✓  ${row.sourceUrl} → ${chip.label ?? "(no label)"} · ${chip.transponder} · ${chip.location ?? "?"}`);
      if (!apply) continue;

      const current = await prisma.importedLapTimeSession.findUnique({
        where: { id: row.id },
        select: { parsedPayload: true },
      });
      const parsed = (current?.parsedPayload ?? {}) as Record<string, unknown>;
      const hint = (parsed.sessionHint && typeof parsed.sessionHint === "object" ? parsed.sessionHint : {}) as Record<
        string,
        unknown
      >;
      await prisma.importedLapTimeSession.update({
        where: { id: row.id },
        data: {
          parsedPayload: {
            ...parsed,
            sessionHint: {
              ...hint,
              practiceTransponder: chip.transponder,
              // What the practice list showed when a rival was brought in wins over the API's label.
              ...(hint.practiceSiteName ? {} : chip.label ? { practiceSiteName: chip.label } : {}),
              ...(hint.practiceLocationName ? {} : chip.location ? { practiceLocationName: chip.location } : {}),
            },
          },
        },
      });
    }

    console.log(
      `\n${named} named, ${missed} missed, ${chipByActivity.size} practice visit(s) asked${apply ? "" : " (dry run)"}.`
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
