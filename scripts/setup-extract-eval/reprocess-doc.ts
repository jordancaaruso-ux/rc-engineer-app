/**
 * Re-run the import pipeline for one SetupDocument (Stage 2A pilot verification).
 * The app only re-processes via upload or the calibration-gated /process endpoint, so this
 * script exists for pilot/dev verification of AI-path docs.
 *
 *   npm run setup-extract:reprocess -- --doc=<setupDocumentId>
 *
 * Runs with --conditions=react-server so the pipeline's "server-only" imports resolve.
 */
import { prisma } from "@/lib/prisma";
import { processSetupDocumentImport } from "@/lib/setupDocuments/processImport";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const docId = arg("doc");
  if (!docId) {
    console.error("Usage: npm run setup-extract:reprocess -- --doc=<setupDocumentId>");
    process.exit(1);
  }
  const doc = await prisma.setupDocument.findUnique({
    where: { id: docId },
    select: { id: true, userId: true, originalFilename: true, importStatus: true },
  });
  if (!doc) throw new Error(`SetupDocument not found: ${docId}`);
  console.log(`Re-processing ${doc.id} (${doc.originalFilename}, status=${doc.importStatus})…`);
  const t0 = Date.now();
  await processSetupDocumentImport({ docId: doc.id, userId: doc.userId });
  const after = await prisma.setupDocument.findUnique({
    where: { id: docId },
    select: { parseStatus: true, importOutcome: true, importDiagnosticJson: true },
  });
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s: parseStatus=${after?.parseStatus} outcome=${after?.importOutcome}`);
  const diag = after?.importDiagnosticJson as {
    kind?: string;
    importedCount?: number;
    fieldCount?: number;
    flaggedKeys?: string[];
    disagreedKeys?: string[];
    regionKeys?: string[];
  } | null;
  if (diag?.kind === "ai_extraction_diagnostic_v1") {
    console.log(
      `AI diagnostic: imported ${diag.importedCount}/${diag.fieldCount}, flagged ${diag.flaggedKeys?.length ?? 0}, `
        + `disagreed ${diag.disagreedKeys?.length ?? 0}, region-adjudicated ${diag.regionKeys?.length ?? 0}`
    );
    if (diag.regionKeys?.length) console.log(`  regionKeys: ${diag.regionKeys.join(", ")}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
