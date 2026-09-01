/** Compare the fresh re-import of an old-layout PDF against what the same file produced historically. */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalize(v: unknown): string {
  return JSON.stringify(v);
}

async function main() {
  const [snapshotId, storageFragment] = [process.argv[2]!, process.argv[3]!];
  const snap = await prisma.setupSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    select: { data: true },
  });
  const oldDoc = await prisma.setupDocument.findFirstOrThrow({
    where: { storagePath: { contains: storageFragment } },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, parsedDataJson: true, originalFilename: true },
  });
  const fresh = snap.data as Record<string, unknown>;
  const old = (oldDoc.parsedDataJson ?? {}) as Record<string, unknown>;
  console.log(`historical doc ${oldDoc.id} (${oldDoc.originalFilename}, ${oldDoc.createdAt.toISOString()}): ${Object.keys(old).length} keys`);
  console.log(`fresh snapshot: ${Object.keys(fresh).length} keys`);

  const allKeys = [...new Set([...Object.keys(old), ...Object.keys(fresh)])].sort();
  let same = 0;
  const diffs: string[] = [];
  for (const k of allKeys) {
    const a = old[k];
    const b = fresh[k];
    if (normalize(a) === normalize(b)) { same++; continue; }
    diffs.push(`  ${k}: old=${normalize(a)?.slice(0, 80)} new=${normalize(b)?.slice(0, 80)}`);
  }
  console.log(`identical values: ${same}/${allKeys.length}; differing/one-sided: ${diffs.length}`);
  for (const d of diffs) console.log(d);
}

main().finally(() => prisma.$disconnect());
