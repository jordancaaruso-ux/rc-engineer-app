/**
 * Stamp `SetupSnapshot.sheetBlankId` on setups born before the stamp existed.
 *
 * Two passes, run to a fixpoint:
 *   1. SEED — a snapshot created from a document that resolved through an EDITION's calibration
 *      was born on that edition's paper (`SetupDocument.createdSetupId`).
 *   2. CLOSURE — a snapshot whose `baseSetupSnapshotId` points at a stamped one is a copy of it
 *      (run snapshots, corrections, keeps) and inherits the stamp, exactly as the live code now
 *      inherits it at create time.
 *
 * Only ever fills NULL stamps — a stamp already present is never rewritten.
 *
 * Run: npx dotenv-cli -e <env> -- npx tsx scripts/backfill-a800rr-sheet-provenance.ts [--apply]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const editionBlanks = await prisma.setupSheetBlank.findMany({
    where: { isEdition: true, setupDocumentId: { not: null }, setupSheetModelId: { not: null } },
    select: { id: true, setupDocumentId: true, setupSheetModelId: true },
  });
  console.log(`edition blanks: ${editionBlanks.length}`);

  let stamped = 0;
  const stamp = async (snapshotId: string, blankId: string, why: string) => {
    const row = await prisma.setupSnapshot.findUnique({
      where: { id: snapshotId },
      select: { sheetBlankId: true },
    });
    if (!row || row.sheetBlankId) return false;
    console.log(`  stamp ${snapshotId} → ${blankId} (${why})`);
    if (APPLY) {
      await prisma.setupSnapshot.update({ where: { id: snapshotId }, data: { sheetBlankId: blankId } });
    }
    stamped += 1;
    return true;
  };

  // Pass 1: imports through each edition's calibration.
  for (const blank of editionBlanks) {
    const calibration = await prisma.setupSheetCalibration.findFirst({
      where: { setupSheetModelId: blank.setupSheetModelId!, exampleDocumentId: blank.setupDocumentId! },
      select: { id: true },
    });
    if (!calibration) continue;
    const docs = await prisma.setupDocument.findMany({
      where: { calibrationResolvedProfileId: calibration.id, createdSetupId: { not: null } },
      select: { createdSetupId: true },
    });
    for (const d of docs) await stamp(d.createdSetupId!, blank.id, `import via ${calibration.id}`);
  }

  // Pass 2: copies of stamped snapshots inherit, to a fixpoint. Dry runs cannot see their own
  // would-be stamps in the DB, so the closure walks an in-memory picture of them instead.
  const known = new Map<string, string>();
  const preStamped = await prisma.setupSnapshot.findMany({
    where: { sheetBlankId: { not: null } },
    select: { id: true, sheetBlankId: true },
  });
  for (const s of preStamped) known.set(s.id, s.sheetBlankId!);
  if (!APPLY) {
    // Re-derive pass 1's stamps for the in-memory picture.
    for (const blank of editionBlanks) {
      const calibration = await prisma.setupSheetCalibration.findFirst({
        where: { setupSheetModelId: blank.setupSheetModelId!, exampleDocumentId: blank.setupDocumentId! },
        select: { id: true },
      });
      if (!calibration) continue;
      const docs = await prisma.setupDocument.findMany({
        where: { calibrationResolvedProfileId: calibration.id, createdSetupId: { not: null } },
        select: { createdSetupId: true },
      });
      for (const d of docs) if (!known.has(d.createdSetupId!)) known.set(d.createdSetupId!, blank.id);
    }
  } else {
    const fresh = await prisma.setupSnapshot.findMany({
      where: { sheetBlankId: { not: null } },
      select: { id: true, sheetBlankId: true },
    });
    for (const s of fresh) known.set(s.id, s.sheetBlankId!);
  }

  for (let round = 0; round < 20; round++) {
    const children = await prisma.setupSnapshot.findMany({
      where: { baseSetupSnapshotId: { in: [...known.keys()] }, sheetBlankId: null },
      select: { id: true, baseSetupSnapshotId: true },
    });
    const next = children.filter((c) => !known.has(c.id));
    if (next.length === 0) break;
    for (const c of next) {
      const blankId = known.get(c.baseSetupSnapshotId!)!;
      await stamp(c.id, blankId, `copy of ${c.baseSetupSnapshotId}`);
      known.set(c.id, blankId);
    }
  }

  console.log(`${APPLY ? "stamped" : "would stamp"}: ${stamped} snapshots`);
}

main().finally(() => prisma.$disconnect());
