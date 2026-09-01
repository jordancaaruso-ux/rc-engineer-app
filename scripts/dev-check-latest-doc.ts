import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const docs = await prisma.setupDocument.findMany({
    where: { user: { email: "jordancaaruso@gmail.com" } },
    orderBy: { createdAt: "desc" },
    take: Number(process.argv[2] ?? 2),
    select: {
      id: true, createdAt: true, originalFilename: true, importStatus: true, importOutcome: true,
      calibrationResolvedProfileId: true, calibrationResolvedSource: true, calibrationResolvedDebug: true,
      importErrorMessage: true,
    },
  });
  for (const d of docs) {
    console.log(`${d.createdAt.toISOString()} ${d.originalFilename}`);
    console.log(`  status=${d.importStatus} outcome=${d.importOutcome}`);
    console.log(`  calibration=${d.calibrationResolvedProfileId} source=${d.calibrationResolvedSource}`);
    console.log(`  debug=${d.calibrationResolvedDebug?.slice(0, 300)}`);
    if (d.importErrorMessage) console.log(`  error=${d.importErrorMessage}`);
  }
}

main().finally(() => prisma.$disconnect());
