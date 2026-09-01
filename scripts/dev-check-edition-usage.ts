import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Edition-only vocabulary: keys that exist ONLY in the edition's schemaFieldsJson, never in the
// model's canonical schema. A snapshot holding one of these was written through the edition.
const EDITION_ONLY_KEYS = [
  "front_shock_oil",
  "ff_inner_top_link_spacer",
  "front_upper_hub_spacer",
  "rear_bump_steer_spacer",
  "front_damping",
];

async function main() {
  const docs = await prisma.setupDocument.findMany({
    where: { calibrationResolvedProfileId: "cmsvng6m00003jn04kr0nzqlw" },
    select: {
      id: true, createdAt: true, originalFilename: true, importOutcome: true, importStatus: true,
      user: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`documents resolved via the edition calibration: ${docs.length}`);
  for (const d of docs) {
    console.log(`  ${d.createdAt.toISOString()} ${d.originalFilename} status=${d.importStatus} outcome=${d.importOutcome} user=${d.user?.email}`);
  }

  for (const key of EDITION_ONLY_KEYS) {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; createdat: Date; email: string | null; name: string | null }>>(
      `SELECT s.id, s."createdAt" as createdat, u.email, s.name
       FROM "SetupSnapshot" s JOIN "User" u ON u.id = s."userId"
       WHERE s.data ? $1
       ORDER BY s."createdAt" ASC LIMIT 20`,
      key,
    );
    console.log(`snapshots containing edition key "${key}": ${rows.length}${rows.length === 20 ? "+" : ""}`);
    for (const r of rows) console.log(`  ${r.id} ${new Date(r.createdat).toISOString()} ${r.email} name=${r.name}`);
  }

  const drafts = await prisma.$queryRawUnsafe<Array<{ id: string; email: string | null }>>(
    `SELECT d.id, u.email FROM "SetupFillDraft" d JOIN "User" u ON u.id = d."userId"
     WHERE d."valuesJson" ? 'front_shock_oil' LIMIT 10`,
  ).catch((e) => { console.log("fill-draft check skipped:", (e as Error).message.slice(0, 120)); return []; });
  console.log(`fill drafts containing edition keys: ${drafts.length}`);
  for (const d of drafts) console.log(`  ${d.id} ${d.email}`);
}

main().finally(() => prisma.$disconnect());
