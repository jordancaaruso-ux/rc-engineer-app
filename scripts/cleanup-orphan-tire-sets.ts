/**
 * One-off cleanup for the wear-first tire identity rework (v2, July 2026).
 *
 * The old add-run flow POSTed a tire set the moment "Add set" was tapped, so abandoned
 * forms left orphan sets and inflated the per-compound setNumber counter (hence sets
 * numbered ~1000). v2 creates sets on run save, so this script:
 *
 *   1. Deletes orphan sets — zero linked runs AND initialRunCount = 0 AND no notes/
 *      specific model (i.e. rows that carry no information a driver typed).
 *   2. Renumbers setNumber per (user, compound) to 1..k by createdAt, so the internal
 *      counter is sane again (it's not shown as identity, but no reason to leave 1000s).
 *
 * Dry-run by default — prints what it would do. Pass --apply to execute.
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/cleanup-orphan-tire-sets.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(APPLY ? "APPLY mode — writing changes." : "DRY RUN — pass --apply to execute.");

  const orphans = await prisma.tireSet.findMany({
    where: {
      runs: { none: {} },
      initialRunCount: 0,
      OR: [{ notes: null }, { notes: "" }],
    },
    select: {
      id: true,
      label: true,
      setNumber: true,
      specificModel: true,
      createdAt: true,
      userId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const deletable = orphans.filter((o) => !o.specificModel?.trim());

  console.log(`\nOrphan sets (no runs, no declared wear, no notes/model): ${deletable.length}`);
  for (const o of deletable) {
    console.log(
      `  - ${o.label} · setNumber ${o.setNumber} · created ${o.createdAt.toISOString().slice(0, 10)} (${o.id})`
    );
  }
  const kept = orphans.length - deletable.length;
  if (kept > 0) console.log(`  (${kept} run-less set(s) kept: they carry a specific model)`);

  if (APPLY && deletable.length > 0) {
    const res = await prisma.tireSet.deleteMany({
      where: { id: { in: deletable.map((o) => o.id) } },
    });
    console.log(`Deleted ${res.count} orphan set(s).`);
  }

  // Renumber per (user, compound-or-legacy-label) by createdAt.
  const all = await prisma.tireSet.findMany({
    select: { id: true, label: true, setNumber: true, tireTypeId: true, userId: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const deletedIds = new Set(APPLY ? deletable.map((o) => o.id) : []);
  const groups = new Map<string, typeof all>();
  for (const ts of all) {
    if (deletedIds.has(ts.id)) continue;
    if (!APPLY && deletable.some((o) => o.id === ts.id)) continue; // preview post-delete numbering
    const key = `${ts.userId}::${ts.tireTypeId ?? `label:${ts.label}`}`;
    const list = groups.get(key);
    if (list) list.push(ts);
    else groups.set(key, [ts]);
  }

  let renumbered = 0;
  for (const [, list] of groups) {
    for (let i = 0; i < list.length; i++) {
      const want = i + 1;
      if (list[i].setNumber !== want) {
        renumbered++;
        console.log(`  renumber: ${list[i].label} ${list[i].setNumber} -> ${want} (${list[i].id})`);
        if (APPLY) {
          await prisma.tireSet.update({ where: { id: list[i].id }, data: { setNumber: want } });
        }
      }
    }
  }
  console.log(`\nSet numbers ${APPLY ? "updated" : "needing renumber"}: ${renumbered}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
