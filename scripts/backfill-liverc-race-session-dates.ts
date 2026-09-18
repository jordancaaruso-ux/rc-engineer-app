/**
 * Give every already-imported LiveRC session the date it was actually RACED.
 *
 * Until 2026-09-18 the race-result parser only looked for a date with a WEEKDAY in front of it
 * ("Saturday, 8 April 2025"), and LiveRC writes the date in the page's breadcrumb as
 * "Jul 15, 2026". So it found nothing, stored no on-track time, and every screen fell back to
 * the moment of import — 194 of 217 race imports on file. The parser reads the breadcrumb now,
 * but only for imports made from here on: the date was never stored, so the rows already in the
 * table have to be re-fetched.
 *
 * Idempotent. Only touches rows with NO `sessionCompletedAt`, and only writes when a date
 * actually comes back off the page.
 *
 *   npm run laps:backfill-liverc-dates              # dry run, prints what it would write
 *   npm run laps:backfill-liverc-dates -- --apply
 *   npm run laps:backfill-liverc-dates -- --apply --limit 20
 *
 * Writes BOTH `sessionCompletedAt` and the payload's `sessionCompletedAtIso`, because
 * `resolveImportedSessionDisplayTimeIso` reads the payload first and the column second — leaving
 * one behind would have two screens disagreeing about one session.
 *
 * Runs are NOT touched. A run carries its own stamp, and re-dating someone's logged run is a
 * separate decision; the summary counts how many are linked so that call can be made with a
 * number in hand.
 *
 * One page at a time with a pause between: this is someone else's timing site, and there is no
 * hurry on a one-off repair.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { fetchUrlText } from "../src/lib/lapUrlParsers/fetchText";
import {
  extractLiveRcPracticeSessionWhenFromHtml,
  extractLiveRcRaceSessionWhenRaw,
  parseLiveRcSessionDisplayTimeToUtcIso,
} from "../src/lib/lapUrlParsers/livercSessionTime";

const PAUSE_MS = 750;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.POSITIVE_INFINITY;

type Row = {
  id: string;
  sourceUrl: string;
  parserId: string;
  createdAt: Date;
  linkedRunId: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Practice and race pages print their time in different places; each has its own reader. */
function whenRawFromHtml(parserId: string, html: string): string | null {
  return parserId.includes("practice")
    ? extractLiveRcPracticeSessionWhenFromHtml(html)
    : extractLiveRcRaceSessionWhenRaw(html);
}

function fmt(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `select id, "sourceUrl", "parserId", "createdAt", "linkedRunId"
         from "ImportedLapTimeSession"
        where "sessionCompletedAt" is null
          and "sourceUrl" like '%liverc.com%'
        order by "createdAt" desc`
    );

    const races = rows.filter((r) => !r.parserId.includes("practice")).length;
    console.log(
      `${rows.length} LiveRC session(s) with no on-track date — ${races} race, ${rows.length - races} practice.`
    );
    console.log(apply ? "APPLYING." : "(dry run — pass --apply to write)\n");

    /** One fetch per distinct URL: a page imported by three accounts is still one page. */
    const isoByUrl = new Map<string, string | null>();
    let dated = 0;
    let missed = 0;
    let linkedRuns = 0;
    let done = 0;

    for (const row of rows) {
      if (done >= limit) break;
      done += 1;

      let iso = isoByUrl.get(row.sourceUrl);
      if (iso === undefined) {
        const fetched = await fetchUrlText(row.sourceUrl);
        const raw = fetched.ok ? whenRawFromHtml(row.parserId, fetched.text) : null;
        iso = raw ? parseLiveRcSessionDisplayTimeToUtcIso(raw) : null;
        isoByUrl.set(row.sourceUrl, iso);
        await sleep(PAUSE_MS);
      }

      const importedAt = fmt(row.createdAt.toISOString());
      if (!iso) {
        missed += 1;
        console.log(`  -  showed "${importedAt}" → no date on the page, left alone`);
        continue;
      }

      dated += 1;
      if (row.linkedRunId) linkedRuns += 1;
      console.log(`  ✓  showed "${importedAt}" → raced ${fmt(iso)}${row.linkedRunId ? "  [has a run]" : ""}`);
      if (!apply) continue;

      const current = await prisma.importedLapTimeSession.findUnique({
        where: { id: row.id },
        select: { parsedPayload: true },
      });
      const parsed = (current?.parsedPayload ?? {}) as Record<string, unknown>;
      await prisma.importedLapTimeSession.update({
        where: { id: row.id },
        data: {
          sessionCompletedAt: new Date(iso),
          parsedPayload: { ...parsed, sessionCompletedAtIso: iso } as Prisma.InputJsonValue,
        },
      });
    }

    console.log(
      `\n${dated} dated, ${missed} left alone, ${isoByUrl.size} page(s) fetched.` +
        (linkedRuns ? `\n${linkedRuns} of the dated sessions have a logged run attached (not touched).` : "")
    );
    if (!apply) console.log("Nothing written.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
