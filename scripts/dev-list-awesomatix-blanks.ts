import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const models = await prisma.setupSheetModel.findMany({
    where: { OR: [{ name: { contains: "wesomatix", mode: "insensitive" } }, { slug: { contains: "a800" } }, { name: { contains: "A800" } }] },
    select: { id: true, name: true, slug: true, isAuthorized: true, createdAt: true },
  });
  console.log("MODELS:", JSON.stringify(models, null, 2));

  const modelIds = models.map((m) => m.id);
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupSheetModelId: { in: modelIds } },
    select: {
      id: true, createdAt: true, status: true, source: true, isEdition: true, fingerprint: true,
      setupSheetModelId: true,
      setupDocument: { select: { id: true, originalFilename: true, storagePath: true, createdAt: true, user: { select: { email: true, name: true } } } },
      schemaFieldsJson: true,
    },
    orderBy: { createdAt: "asc" },
  });
  for (const b of blanks) {
    const fields = Array.isArray(b.schemaFieldsJson) ? (b.schemaFieldsJson as unknown[]).length : null;
    console.log(`BLANK ${b.id} model=${b.setupSheetModelId} edition=${b.isEdition} status=${b.status} source=${b.source} created=${b.createdAt.toISOString()} fields=${fields}`);
    console.log(`  doc: ${b.setupDocument?.originalFilename} | ${b.setupDocument?.storagePath} | uploader=${b.setupDocument?.user?.email ?? "?"} (${b.setupDocument?.user?.name ?? ""}) | ${b.setupDocument?.createdAt.toISOString()}`);
  }

  const cals = await prisma.setupSheetCalibration.findMany({
    where: { setupSheetModelId: { in: modelIds } },
    select: { id: true, name: true, sourceType: true, createdAt: true, verifiedAt: true, setupSheetModelId: true, user: { select: { email: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log("CALIBRATIONS:", JSON.stringify(cals, null, 2));
}

main().finally(() => prisma.$disconnect());
