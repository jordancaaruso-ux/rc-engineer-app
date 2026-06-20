/**
 * Export promoted gold-set candidates from DB → scripts/engineer-eval/gold-set-auto.json
 * Run: npm run engineer:sync-gold-set
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { goldCasesFromCandidates } from "@/lib/engineerFeedback/goldSetCandidateUtil";

async function main() {
  const rows = await prisma.engineerGoldSetCandidate.findMany({
    where: { status: "promoted" },
    orderBy: { promotedAt: "asc" },
    select: {
      id: true,
      promotedCaseId: true,
      question: true,
      runId: true,
      compareRunId: true,
    },
  });

  const cases = goldCasesFromCandidates(rows);
  const outPath = path.join(process.cwd(), "scripts/engineer-eval/gold-set-auto.json");
  const payload = {
    version: 1,
    description: "Auto-exported promoted founder questions. Do not edit by hand — use Settings admin UI.",
    generatedAtIso: new Date().toISOString(),
    cases,
  };
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${cases.length} promoted case(s) to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
