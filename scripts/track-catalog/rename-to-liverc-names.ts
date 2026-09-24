/**
 * Rename driver-added tracks that carry a LiveRC link to the name LiveRC gives them — so every
 * LiveRC track in the catalog reads the same way, whether a driver typed it or the import wrote it.
 * Founder call 2026-09-16: "Boronia" → "Boronia Radio Controlled Car Club inc", same tidy as the
 * import (ALL CAPS / all lowercase softened, words unchanged).
 *
 * Also stamps `catalogEventCount`, so a renamed track sorts among the busiest on /tracks instead of
 * after the thousand imported rows.
 *
 * Search still finds "SERCCC" after the rename (it matches the LiveRC link too — see
 * `communityTrackListWhere`), and adding a track called "SERCCC" hands back this one (POST /api/tracks).
 *
 * Skipped, never guessed:
 *  - throwaway `+ob…` accounts' tracks;
 *  - hosts missing from the 2026-08-19 LiveRC sweep (e.g. the fake Ironbark timing site);
 *  - a rename that would give two tracks the same name in the same catalog (demo and real are
 *    separate catalogs) — e.g. a leftover test track pointing at tftr.liverc.com.
 *
 * DRY RUN by default. `--apply` writes and saves `seeds/track-catalog/rename-undo-<time>.json`.
 * `--revert <file>` (+ `--apply`) puts each old name back, unless it has been renamed again since.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/track-catalog/rename-to-liverc-names.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { TrackCandidate } from "./candidateTypes";
import { tidyName } from "../../src/lib/tracks/tidyTrackName";
import { demoCatalogUserId } from "../../src/lib/demo/demoAccess";
import { isThrowawayEmail } from "../../src/lib/account/throwawayAccounts";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const revertIndex = process.argv.indexOf("--revert");
const REVERT_FILE = revertIndex >= 0 ? process.argv[revertIndex + 1] : null;

type UndoRow = {
  id: string;
  before: { name: string; catalogEventCount: number | null };
  after: { name: string; catalogEventCount: number | null };
};

function dbHost(): string {
  return process.env.DATABASE_URL?.split("@")[1]?.split("/")[0] ?? "unknown";
}

function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

async function revert(file: string): Promise<void> {
  const { rows } = JSON.parse(fs.readFileSync(file, "utf8")) as { rows: UndoRow[] };
  console.log(`${APPLY ? "REVERT" : "REVERT DRY RUN"} against ${dbHost()} — ${rows.length} rows from ${file}`);
  let restored = 0;
  for (const r of rows) {
    const now = await prisma.track.findUnique({ where: { id: r.id }, select: { name: true } });
    if (!now) {
      console.log(`  ! ${r.after.name}: track no longer exists`);
      continue;
    }
    if (now.name !== r.after.name) {
      console.log(`  ! ${now.name}: renamed again since — left alone`);
      continue;
    }
    console.log(`  ${r.after.name}  →  ${r.before.name}`);
    if (APPLY) {
      await prisma.track.update({ where: { id: r.id }, data: r.before });
      restored++;
    }
  }
  console.log(APPLY ? `Restored ${restored}.` : "\nNothing written. Re-run with --apply.");
}

async function rename(): Promise<void> {
  const doc = JSON.parse(fs.readFileSync("seeds/track-catalog/candidates.json", "utf8")) as {
    candidates: TrackCandidate[];
  };
  const byHost = new Map(
    doc.candidates.filter((c) => c.source === "liverc").map((c) => [c.sourceRef.toLowerCase(), c])
  );
  const demoId = demoCatalogUserId();

  const all = (
    await prisma.track.findMany({
      select: {
        id: true,
        name: true,
        liveRcUrl: true,
        catalogSource: true,
        catalogEventCount: true,
        userId: true,
        user: { select: { email: true } },
        _count: { select: { runs: true } },
      },
    })
  ).filter((t) => !isThrowawayEmail(t.user.email));
  const catalogOf = (t: { userId: string }) => (t.userId === demoId ? "demo" : "real");

  const undo: UndoRow[] = [];
  const notes: string[] = [];
  for (const t of all) {
    if (t.catalogSource === "liverc" || !t.liveRcUrl) continue;
    const h = host(t.liveRcUrl);
    const c = h ? byHost.get(h) : undefined;
    if (!c) {
      notes.push(`  - ${t.name} (${h ?? t.liveRcUrl}) — not on LiveRC's list, left alone`);
      continue;
    }
    // Same words with only the capitals different — the driver's "Radio Racing Cars SA" against
    // LiveRC's "Radio racing cars sa" — is already the LiveRC name, and the driver's spelling is the
    // tidier one, so it stays (founder's rename on production, 2026-09-24).
    const liveName = tidyName(c.name);
    const sameWords = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const name = sameWords(liveName) === sameWords(t.name) ? t.name : liveName;
    const catalogEventCount = c.eventCount ?? null;
    if (name === t.name && catalogEventCount === t.catalogEventCount) continue;

    const clash = all.find(
      (o) =>
        o.id !== t.id &&
        catalogOf(o) === catalogOf(t) &&
        o.name.toLowerCase() === name.toLowerCase()
    );
    if (clash && name !== t.name) {
      notes.push(`  - ${t.name} (${t._count.runs} runs) — "${name}" already exists in the ${catalogOf(t)} catalog, left alone`);
      continue;
    }
    undo.push({
      id: t.id,
      before: { name: t.name, catalogEventCount: t.catalogEventCount },
      after: { name, catalogEventCount },
    });
    // The planned name now occupies that slot, so a second row can't also claim it.
    t.name = name;
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} against ${dbHost()}`);
  for (const r of undo) {
    const row = all.find((t) => t.id === r.id)!;
    const renamed = r.before.name !== r.after.name ? `${r.before.name}  →  ${r.after.name}` : `${r.after.name} (name already right)`;
    console.log(`  ${catalogOf(row)} | ${renamed} | events ${r.after.catalogEventCount ?? "?"} | ${row._count.runs} runs`);
  }
  if (notes.length) {
    console.log("\nleft alone:");
    for (const n of notes) console.log(n);
  }
  if (!APPLY) {
    console.log("\nNothing written. Re-run with --apply.");
    return;
  }
  const file = `seeds/track-catalog/rename-undo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.writeFileSync(file, JSON.stringify({ appliedAt: new Date().toISOString(), db: dbHost(), rows: undo }, null, 1));
  for (const r of undo) await prisma.track.update({ where: { id: r.id }, data: r.after });
  console.log(`\nUpdated ${undo.length}. Undo: --revert ${file} --apply`);
}

(REVERT_FILE ? revert(REVERT_FILE) : rename())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
