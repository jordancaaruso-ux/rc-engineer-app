import { PrismaClient } from "@prisma/client";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const prisma = new PrismaClient();

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(process.cwd(), "backups", `setup-calibrations-${stamp}.json`);

  const calibrations = await prisma.setupSheetCalibration.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      sourceType: true,
      calibrationDataJson: true,
      exampleDocumentId: true,
      userId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const payload = {
    exportedAt: new Date().toISOString(),
    count: calibrations.length,
    calibrations,
  };

  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  // eslint-disable-next-line no-console
  console.log(`[export] wrote ${calibrations.length} calibration(s) to ${outPath}`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[export] failed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

