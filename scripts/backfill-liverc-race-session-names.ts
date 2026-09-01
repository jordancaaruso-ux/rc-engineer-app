/**
 * Give every already-imported LiveRC race its name back.
 *
 * The race parser used to file a diagnostic marker (`racer_laps_session_loaded`) in
 * `sessionHint.className`, and the library printed that as the session's title — so a whole
 * account's races read `racer_laps_session_loaded` instead of `ISTC Modified A3-Main`. The
 * parser now reads the name off the page `<title>`, but only for imports made from here on:
 * the name was never stored, so the rows already in the table have to be re-fetched.
 *
 * Idempotent. Only touches rows whose stored hint is one of the markers and which have no
 * detection label or class of their own, and only writes when a name actually comes back.
 *
 *   npm run laps:backfill-liverc-names              # dry run, prints what it would write
 *   npm run laps:backfill-liverc-names -- --apply
 *   npm run laps:backfill-liverc-names -- --apply --limit 20
 *
 * One page at a time with a pause between: this is someone else's timing site, and there is
 * no hurry on a one-off repair.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import { fetchUrlText } from "../src/lib/lapUrlParsers/fetchText";
import { extractLiveRcRaceSessionNameFromHtml } from "../src/lib/lapUrlParsers/livercSessionTime";

const MARKERS = ["racer_laps_session_loaded", "racer_laps_embed_failed"];
const PAUSE_MS = 750;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Number.POSITIVE_INFINITY;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ id: string; sourceUrl: string }[]>(
      `select id, "sourceUrl"
         from "ImportedLapTimeSession"
        where coalesce("eventDetectionSessionLabel", '') = ''
          and coalesce("eventRaceClass", '') = ''
          and "parsedPayload"->'sessionHint'->>'className' = any($1)
          and "sourceUrl" like '%liverc.com%'
        order by "createdAt" desc`,
      MARKERS
    );

    console.log(`${rows.length} session(s) carrying a marker instead of a name.`);
    if (!apply) console.log("(dry run — pass --apply to write)");

    /** One fetch per distinct URL: a page imported by three accounts is still one page. */
    const nameByUrl = new Map<string, string | null>();
    let named = 0;
    let missed = 0;
    let done = 0;

    for (const row of rows) {
      if (done >= limit) break;
      done += 1;

      let name = nameByUrl.get(row.sourceUrl);
      if (name === undefined) {
        const fetched = await fetchUrlText(row.sourceUrl);
        name = fetched.ok ? extractLiveRcRaceSessionNameFromHtml(fetched.text) : null;
        nameByUrl.set(row.sourceUrl, name);
        await sleep(PAUSE_MS);
      }

      if (!name) {
        missed += 1;
        console.log(`  -  ${row.sourceUrl} → no name on the page`);
        continue;
      }

      named += 1;
      console.log(`  ✓  ${row.sourceUrl} → ${name}`);
      if (!apply) continue;

      const current = await prisma.importedLapTimeSession.findUnique({
        where: { id: row.id },
        select: { parsedPayload: true },
      });
      const parsed = (current?.parsedPayload ?? {}) as Record<string, unknown>;
      const hint = (parsed.sessionHint ?? {}) as Record<string, unknown>;
      await prisma.importedLapTimeSession.update({
        where: { id: row.id },
        data: {
          parsedPayload: {
            ...parsed,
            sessionHint: { ...hint, className: name },
          } as Prisma.InputJsonValue,
        },
      });
    }

    console.log(`\n${named} named, ${missed} left alone, ${nameByUrl.size} page(s) fetched.`);
    if (!apply) console.log("Nothing written.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
