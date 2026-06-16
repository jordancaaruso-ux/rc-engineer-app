import { prisma } from "@/lib/prisma";
import seedData from "../../../scripts/seed-tire-types.json";

type SeedRow = { displayName: string; modelCode: string };

export async function ensureSeedTireTypes(): Promise<number> {
  const rows = seedData as SeedRow[];
  let created = 0;
  for (const row of rows) {
    const displayName = row.displayName.trim();
    const modelCode = row.modelCode.trim().toUpperCase();
    if (!displayName || !modelCode) continue;
    const existing = await prisma.tireType.findUnique({ where: { modelCode }, select: { id: true } });
    if (existing) continue;
    await prisma.tireType.create({
      data: { displayName, modelCode },
    });
    created++;
  }
  return created;
}
