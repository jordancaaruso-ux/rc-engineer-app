/**
 * READ-ONLY diagnostic: why did a Mugen MTC3 PDF upload resolve to the wrong (A800RR) template?
 *
 * Pulls the pick-path evidence recorded on SetupDocument for uploads that look MTC3/Mugen/A800-related
 * and prints, per document:
 *   - who uploaded it + filename + when
 *   - calibrationResolvedSource + calibrationResolvedDebug  (the smoking gun; "quickCreate:auto ..."
 *     with no ":scoped"/":global" => NULL model context => unguarded global picker fired)
 *   - the doc's setupSheetModel (chassis context that reached the request)
 *   - the picked calibration: name, its model, its owner, and whether it was verified
 *   - the car it attached to and whether THAT car has a chassis model linked (factor 3)
 *
 * No writes. Safe against prod.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/diag-mtc3-pick.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/diag-mtc3-pick.ts --email someone@example.com
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/diag-mtc3-pick.ts --file mtc3   (filename contains)
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

const EMAIL = argValue("--email");
const FILE = argValue("--file");

async function main(): Promise<void> {
  const ci = { mode: "insensitive" as const };
  // Cast a wide net: filename hints, or the resolved template/debug points at Mugen/MTC3/A800/Awesomatix.
  const nameOr = [
    { originalFilename: { contains: "mtc3", ...ci } },
    { originalFilename: { contains: "mugen", ...ci } },
    { originalFilename: { contains: "a800", ...ci } },
    { calibrationResolvedDebug: { contains: "a800", ...ci } },
    { calibrationResolvedDebug: { contains: "mtc3", ...ci } },
    { calibrationResolvedDebug: { contains: "mugen", ...ci } },
    { calibrationResolvedDebug: { contains: "mismatch", ...ci } },
    { calibrationResolvedDebug: { contains: "global", ...ci } },
    { setupSheetModel: { name: { contains: "a800", ...ci } } },
    { setupSheetModel: { name: { contains: "mtc3", ...ci } } },
    { calibrationProfile: { setupSheetModel: { name: { contains: "a800", ...ci } } } },
    { calibrationProfile: { setupSheetModel: { name: { contains: "mtc3", ...ci } } } },
  ];

  const docs = await prisma.setupDocument.findMany({
    where: {
      mimeType: "application/pdf",
      ...(EMAIL ? { user: { email: { equals: EMAIL, ...ci } } } : {}),
      ...(FILE ? { originalFilename: { contains: FILE, ...ci } } : { OR: nameOr }),
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      createdAt: true,
      originalFilename: true,
      calibrationResolvedSource: true,
      calibrationResolvedDebug: true,
      calibrationProfileId: true,
      setupSheetModel: { select: { id: true, name: true } },
      user: { select: { email: true } },
      car: {
        select: {
          name: true,
          setupSheetModelId: true,
          setupSheetModel: { select: { name: true } },
        },
      },
      calibrationProfile: {
        select: {
          name: true,
          userId: true,
          verifiedAt: true,
          setupSheetModel: { select: { name: true } },
          user: { select: { email: true } },
        },
      },
    },
  });

  console.log(`\n[diag-mtc3-pick] ${docs.length} candidate PDF upload(s)${EMAIL ? ` for ${EMAIL}` : ""}${FILE ? ` matching file~"${FILE}"` : ""}\n`);

  for (const d of docs) {
    const debug = d.calibrationResolvedDebug ?? "";
    // Path inference from the debug prefix (see fingerprintPick.ts debugPrefix values).
    const hadModelContext = /:scoped|:global/.test(debug);
    const pathGuess = hadModelContext
      ? "MODEL CONTEXT PRESENT (guarded path)"
      : /quickCreate:auto/.test(debug)
        ? "NO MODEL CONTEXT (unguarded global picker) <-- factor 3"
        : "unknown";

    const cal = d.calibrationProfile;
    console.log("────────────────────────────────────────────────────────");
    console.log(`doc        ${d.id}   ${d.createdAt.toISOString()}`);
    console.log(`uploader   ${d.user?.email ?? "?"}`);
    console.log(`file       ${d.originalFilename}`);
    console.log(`doc.model  ${d.setupSheetModel ? `${d.setupSheetModel.name} (${d.setupSheetModel.id})` : "NULL  <-- no chassis context reached the request"}`);
    console.log(`car        ${d.car ? `${d.car.name} — model=${d.car.setupSheetModel?.name ?? "NULL (pending / no chassis linked)"}` : "none"}`);
    console.log(`pickSource ${d.calibrationResolvedSource ?? "none"}`);
    console.log(`pickDebug  ${debug || "(empty)"}`);
    console.log(`=> path    ${pathGuess}`);
    if (cal) {
      console.log(
        `picked cal "${cal.name}"  model=${cal.setupSheetModel?.name ?? "UNLINKED"}  owner=${cal.user?.email ?? cal.userId}  verified=${cal.verifiedAt ? cal.verifiedAt.toISOString() : "NO (unverified)"}`
      );
    } else {
      console.log(`picked cal none`);
    }
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
