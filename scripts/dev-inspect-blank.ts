import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const b = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: process.argv[2]! },
    select: {
      id: true, status: true, isEdition: true, createdAt: true, setupSheetModelId: true,
      schemaFieldsJson: true, boxesJson: true, fingerprint: true,
      setupDocument: { select: { originalFilename: true, storagePath: true, user: { select: { email: true } } } },
      setupSheetModel: { select: { slug: true } },
    },
  });
  const boxes = Array.isArray(b.boxesJson) ? (b.boxesJson as Array<{ key: string }>) : [];
  console.log(`${b.id} model=${b.setupSheetModel?.slug} status=${b.status} edition=${b.isEdition} created=${b.createdAt.toISOString()}`);
  console.log(`doc: ${b.setupDocument?.originalFilename} (${b.setupDocument?.user?.email}) storage=${b.setupDocument?.storagePath ? "yes" : "MISSING"}`);
  console.log(`fingerprint: ${b.fingerprint}`);
  console.log(`schemaFieldsJson: ${Array.isArray(b.schemaFieldsJson) ? (b.schemaFieldsJson as unknown[]).length + " fields" : String(b.schemaFieldsJson)}`);
  console.log(`boxes: ${boxes.length}; sample keys: ${boxes.slice(0, 6).map((x) => x.key).join(", ")}`);
}

main().finally(() => prisma.$disconnect());
