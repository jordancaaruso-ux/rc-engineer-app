/** Read-only: dump the newest PARSED image upload's alignment + confidence trail + problem fields. */
import { prisma } from "@/lib/prisma";

async function main() {
  const doc = await prisma.setupDocument.findFirst({
    where: { sourceType: "IMAGE", parseStatus: { in: ["PARSED", "PARTIAL"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, createdAt: true, originalFilename: true, parseStatus: true, importOutcome: true,
      importDiagnosticJson: true, parsedDataJson: true,
    },
  });
  if (!doc) { console.log("no doc"); return; }
  console.log(`doc ${doc.id} ${doc.originalFilename} ${doc.createdAt.toISOString()} ${doc.parseStatus}/${doc.importOutcome}`);
  const diag = doc.importDiagnosticJson as Record<string, unknown>;
  const mapping = diag?.mapping as Record<string, unknown> | undefined;
  console.log("\nalignment:", JSON.stringify(diag?.anchorMatchScore ?? mapping?.alignment ?? { anchor: diag?.anchorMatchScore, pHash: diag?.pHashHamming }));
  console.log("mapping.alignment:", JSON.stringify(mapping?.alignment));
  console.log("expected:", JSON.stringify(mapping?.expected), "matched keys:", JSON.stringify((mapping?.matched as { keys?: number })?.keys));
  console.log("\nwarnings:", JSON.stringify(mapping?.warnings));
  console.log("\nocrConsensus:", JSON.stringify(mapping?.ocrConsensus));
  const p = doc.parsedDataJson as Record<string, unknown>;
  const fields = ["top_deck_screws", "top_deck_cuts", "piston_type_front", "piston_type_rear", "top_deck_thickness_rear", "top_deck_thickness_front"];
  console.log("\nProblem fields:");
  for (const f of fields) console.log(`  ${f.padEnd(26)} ${JSON.stringify(p[f])}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
