import { prisma } from "@/lib/prisma";

import seedData from "../../../scripts/seed-additive-types.json";



type SeedRow = { displayName: string; modelCode: string };



const CANONICAL_ROWS = seedData as SeedRow[];



function normalizeRow(row: SeedRow) {

  return {

    displayName: row.displayName.trim(),

    modelCode: row.modelCode.trim().toUpperCase(),

  };

}



/** Insert canonical catalog rows when the table is empty (page load / API list). */

export async function ensureSeedAdditiveTypes(): Promise<number> {

  let created = 0;

  for (const row of CANONICAL_ROWS) {

    const { displayName, modelCode } = normalizeRow(row);

    if (!displayName || !modelCode) continue;

    const existing = await prisma.additiveType.findUnique({ where: { modelCode }, select: { id: true } });

    if (existing) continue;

    await prisma.additiveType.create({

      data: { displayName, modelCode },

    });

    created++;

  }

  return created;

}



/**

 * Upsert the two canonical Mighty Gripper entries and delete all others.

 * Run.additiveTypeId and EventParticipation.controlledAdditiveTypeId null out on delete (ON DELETE SET NULL).

 */

export async function syncCanonicalAdditiveTypes(): Promise<{ deleted: number; upserted: number }> {

  const canonicalCodes: string[] = [];

  for (const row of CANONICAL_ROWS) {

    const { displayName, modelCode } = normalizeRow(row);

    if (!displayName || !modelCode) continue;

    canonicalCodes.push(modelCode);

    await prisma.additiveType.upsert({

      where: { modelCode },

      create: { displayName, modelCode },

      update: { displayName },

    });

  }

  const deleted = await prisma.additiveType.deleteMany({

    where: { modelCode: { notIn: canonicalCodes } },

  });

  return { deleted: deleted.count, upserted: canonicalCodes.length };

}

