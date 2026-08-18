import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const USER_EMAIL = "lucas.urbain@yahoo.fr";
const CUTOFF = process.argv[2] ? new Date(process.argv[2]) : new Date(Date.now() - 5 * 60 * 1000);
const POLL_MS = 30_000;
const MAX_MS = 90 * 60 * 1000;

function leaves(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  let n = 0;
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") n += leaves(v);
    else n += 1;
  }
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const u = await prisma.user.findUnique({ where: { email: USER_EMAIL }, select: { id: true } });
  if (!u) throw new Error("no user");
  console.log(`watching from ${CUTOFF.toISOString()} (poll ${POLL_MS / 1000}s, give up after ${MAX_MS / 60000}m)`);

  const started = Date.now();
  const reported = new Set<string>();

  while (Date.now() - started < MAX_MS) {
    const docs = await prisma.setupDocument.findMany({
      where: { userId: u.id, createdAt: { gt: CUTOFF } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        createdAt: true,
        originalFilename: true,
        carId: true,
        sourceType: true,
        parseStatus: true,
        importStatus: true,
        importOutcome: true,
        importErrorMessage: true,
        currentStage: true,
        lastCompletedStage: true,
        parsedDataJson: true,
        importDiagnosticJson: true,
        createdSetupId: true,
        setupSheetModelId: true,
        calibrationProfileId: true,
      },
    });

    for (const d of docs) {
      const terminal =
        d.importStatus === "COMPLETED" ||
        d.importStatus === "COMPLETED_WITH_WARNINGS" ||
        d.importStatus === "FAILED";
      if (!terminal) {
        if (!reported.has(`${d.id}:seen`)) {
          reported.add(`${d.id}:seen`);
          console.log(`\n[${new Date().toISOString()}] UPLOAD STARTED: ${d.originalFilename} (${d.sourceType}) — stage ${d.currentStage ?? "?"}`);
        }
        continue;
      }
      if (reported.has(`${d.id}:done`)) continue;
      reported.add(`${d.id}:done`);

      const diag = d.importDiagnosticJson as any;
      const parsed = d.parsedDataJson as Record<string, unknown> | null;
      const car = d.carId ? await prisma.car.findUnique({ where: { id: d.carId }, select: { name: true } }) : null;
      const snap = d.createdSetupId
        ? await prisma.setupSnapshot.findUnique({ where: { id: d.createdSetupId }, select: { data: true } })
        : null;

      console.log(`\n=== [${new Date().toISOString()}] UPLOAD FINISHED ===`);
      console.log(`file:        ${d.originalFilename}`);
      console.log(`uploaded:    ${d.createdAt.toISOString()}`);
      console.log(`car:         ${car?.name ?? "—"}`);
      console.log(`sheet model: ${d.setupSheetModelId ?? "—"}  calibration: ${d.calibrationProfileId ?? "—"}`);
      console.log(`parse:       ${d.parseStatus}   import: ${d.importStatus} / ${d.importOutcome ?? "—"}`);
      console.log(`stage:       ${d.lastCompletedStage ?? "—"} -> ${d.currentStage ?? "—"}`);
      if (d.importErrorMessage) console.log(`error:       ${d.importErrorMessage}`);
      console.log(`parsed keys: ${parsed ? Object.keys(parsed).length : 0}`);
      console.log(`snapshot:    ${d.createdSetupId ?? "NONE"}  filled values: ${leaves(snap?.data)}`);
      if (diag?.mapping) {
        console.log(
          `mapping:     matched ${diag.mapping.matched?.keys ?? "?"} of ${diag.mapping.expected?.formRules ?? "?"} form rules (text ${diag.mapping.expected?.textRules ?? 0}, region ${diag.mapping.expected?.regionRules ?? 0})`,
        );
        console.log(`             used=${JSON.stringify(diag.mapping.used)}`);
        const un = diag.mapping.unmatched?.expectedFormKeys ?? [];
        console.log(`             unmatched expected keys: ${un.length}${un.length ? " e.g. " + un.slice(0, 8).join(", ") : ""}`);
        const present = diag.mapping.unmatched?.presentPdfFieldNamesSample ?? [];
        if (present.length) console.log(`             pdf field names in file: ${present.slice(0, 10).join(" | ")}`);
      }
      console.log(`VERDICT:     ${leaves(snap?.data) >= 60 ? "WORKED — sheet came through full" : "STILL THIN — the sheet did not map"}`);
      console.log("=== END ===");
      await prisma.$disconnect();
      process.exit(0);
    }

    // Also surface any new run he logs in the window.
    const runs = await prisma.run.findMany({
      where: { userId: u.id, createdAt: { gt: CUTOFF } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true, carNameSnapshot: true, setupSnapshot: { select: { data: true } } },
    });
    for (const r of runs) {
      if (reported.has(`run:${r.id}`)) continue;
      reported.add(`run:${r.id}`);
      console.log(
        `[${new Date().toISOString()}] NEW RUN logged: ${r.carNameSnapshot ?? "—"} — setup carries ${leaves(r.setupSnapshot?.data)} values`,
      );
    }

    await sleep(POLL_MS);
  }

  console.log(`\nno new upload in ${MAX_MS / 60000} minutes — giving up at ${new Date().toISOString()}`);
  await prisma.$disconnect();
  process.exit(2);
}

main().catch(async (e) => {
  console.error("watcher died:", e);
  await prisma.$disconnect();
  process.exit(1);
});
