/**
 * Backfill: auto-trust EXISTING admin-authored calibrations by stamping `verifiedAt` (now) on any
 * that are still unverified. Forward-looking creates already stamp on create
 * (verifiedAtForNewCalibration); this catches calibrations made before that change so they enter
 * every user's cross-user auto-pick pool. Idempotent.
 *
 *   Dry-run: npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-admin-calibrations-verified.ts
 *   Apply:   npx dotenv-cli -e .env.local -- npx tsx scripts/backfill-admin-calibrations-verified.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { parseAuthAdminEmails } from "@/lib/authAdminLogic";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const adminEmails = [...parseAuthAdminEmails()];
  console.log(`[backfill-admin-cals] mode=${APPLY ? "APPLY" : "DRY-RUN"} adminEmails=${adminEmails.join(", ") || "(none)"}`);
  if (adminEmails.length === 0) {
    console.error("No AUTH_ADMIN_EMAILS configured — nothing to do.");
    return;
  }

  // Resolve admin user ids case-insensitively (Prisma `in` has no insensitive mode).
  const adminSet = new Set(adminEmails.map((e) => e.toLowerCase()));
  const allUsers = await prisma.user.findMany({ where: { email: { not: null } }, select: { id: true, email: true } });
  const adminIds = allUsers.filter((u) => u.email && adminSet.has(u.email.toLowerCase())).map((u) => u.id);
  if (adminIds.length === 0) {
    console.error("No users matched AUTH_ADMIN_EMAILS — nothing to do.");
    return;
  }

  const rows = await prisma.setupSheetCalibration.findMany({
    where: { verifiedAt: null, userId: { in: adminIds } },
    select: { id: true, name: true, user: { select: { email: true } }, setupSheetModel: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Found ${rows.length} unverified admin-authored calibration(s):`);
  for (const r of rows) {
    console.log(`  - ${r.name}  model=${r.setupSheetModel?.name ?? "unlinked"}  by ${r.user?.email}`);
  }
  if (rows.length === 0 || !APPLY) {
    if (!APPLY && rows.length > 0) console.log("DRY-RUN: re-run with --apply to stamp verifiedAt=now on the above.");
    return;
  }

  const res = await prisma.setupSheetCalibration.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { verifiedAt: new Date() },
  });
  console.log(`Stamped verifiedAt on ${res.count} calibration(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
