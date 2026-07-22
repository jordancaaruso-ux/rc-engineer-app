/**
 * Read-only acceptance test for the server-side flattened-PDF → image bridge.
 *
 * Takes a stored flattened-PDF setup document, rasterizes page 1 via the production render util,
 * runs the real image pipeline against a calibration, and prints how many fields it read. Writes
 * nothing to the DB.
 *
 * Run (server-only imports require the react-server condition):
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/raster-flattened-eval.ts [--doc=<contains>] [--cal=<id>]
 */
import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";
import {
  extractImageRawDataFromFile,
  mapExtractedImageWithCalibration,
} from "@/lib/setupCalibrations/imageExtractPipeline";

function argVal(flag: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
}

async function main() {
  const docContains = argVal("--doc", "x4-26");
  const calId = argVal("--cal", "cmrt9pk250001u4j0tfp68v1q");

  const doc = await prisma.setupDocument.findFirst({
    where: {
      mimeType: "application/pdf",
      originalFilename: { contains: docContains },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, originalFilename: true, storagePath: true, mimeType: true, sourceType: true },
  });
  if (!doc) throw new Error(`No PDF setup document with filename containing "${docContains}"`);
  console.log("=== DOC ===", { id: doc.id, file: doc.originalFilename, mimeType: doc.mimeType, sourceType: doc.sourceType });

  const cal = await prisma.setupSheetCalibration.findUnique({
    where: { id: calId },
    select: { id: true, name: true, calibrationDataJson: true },
  });
  if (!cal) throw new Error(`No calibration ${calId}`);
  console.log("=== CAL ===", { id: cal.id, name: cal.name });

  const pdfBytes = await readBytesFromStorageRef(doc.storagePath);
  console.log(`Read ${pdfBytes.byteLength}b from storage; rasterizing…`);

  const t0 = Date.now();
  const png = await renderPdfFirstPageToPng(new Uint8Array(pdfBytes), { scale: 2 });
  console.log(`Rendered PNG ${png.byteLength}b in ${Date.now() - t0}ms`);

  const file = new File([new Uint8Array(png)], "flattened.png", { type: "image/png" });
  const raw = await extractImageRawDataFromFile({ file, calibrationDataJsonForMeta: cal.calibrationDataJson });
  console.log("=== ALIGN ===", {
    dims: `${raw.widthPx}x${raw.heightPx}`,
    anchorMatchScore: Number(raw.anchorMatchScore.toFixed(3)),
    pHashHamming: raw.pHashHamming,
  });

  const mapped = await mapExtractedImageWithCalibration({
    extracted: raw,
    calibrationDataJson: cal.calibrationDataJson,
    calibrationProfileId: cal.id,
  });
  console.log("=== RESULT ===", {
    importedKeys: mapped.importedKeys.length,
    expected: mapped.diagnostic?.expected,
    warnings: (mapped.diagnostic?.warnings ?? []).slice(0, 12),
  });
  console.log("sampleKeys:", mapped.importedKeys.slice(0, 30).join(", "));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
