/**
 * Delete the placeholder catalog chassis (name-only generic schemas) now that real sheets are
 * being ingested. Keeps Awesomatix and Mugen — founder call 2026-08-11.
 *
 * Mirrors the admin delete route (`DELETE /api/setup-sheet-models/[id]`): suppress the catalog
 * slug first so `ensureAuthorizedSetupSheetCatalog` cannot resurrect the row, then delete. Also
 * clears the legacy `Car.setupSheetTemplate` string on linked cars — nothing else clears it once
 * the model link goes null, and it would linger as a stale aggregation key.
 *
 * Dry-run by default; it prints exactly what --apply would delete and who is affected.
 *
 *   npm run prune-catalog
 *   npm run prune-catalog -- --apply
 *   npm run prune-catalog -- --apply --prod        (after the branch ships)
 *
 * `--conditions=react-server` is required: `@/lib/prisma` imports `server-only`.
 */
import { prisma } from "@/lib/prisma";
import { parseAuthAdminEmails } from "@/lib/authAdminLogic";
import { AUTHORIZED_CHASSIS_CATALOG } from "@/lib/setupSheetModels/authorizedCatalog";
import { suppressCatalogSlug } from "@/lib/setupSheetModels/catalogSuppression";
import { invalidateAuthorizedSetupSheetCatalogCache } from "@/lib/setupSheetModels/seedAuthorizedCatalog";
import { SETUP_SHEET_MODEL_SLUG_A800RR } from "@/lib/setupSheetTemplateId";
import { guardDatabaseTarget } from "./lib/neonEnvGuard";

const KEEP_SLUGS = new Set([SETUP_SHEET_MODEL_SLUG_A800RR, "mugen_mtc3", "mugen_mtc2"]);

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const prodFlag = args.includes("--prod");

  guardDatabaseTarget({ apply, prodFlag });

  const targetSlugs = AUTHORIZED_CHASSIS_CATALOG.map((c) => c.slug).filter(
    (slug) => !KEEP_SLUGS.has(slug)
  );
  console.log(`Keeping: ${[...KEEP_SLUGS].join(", ")}`);
  console.log(`Targets: ${targetSlugs.join(", ")}\n`);

  const models = await prisma.setupSheetModel.findMany({
    where: { slug: { in: targetSlugs } },
    select: {
      id: true,
      name: true,
      slug: true,
      cars: { select: { id: true, name: true, user: { select: { email: true } } } },
      _count: {
        select: {
          baselineSetups: true,
          setupFillDrafts: true,
          calibrations: true,
          setupDocuments: true,
        },
      },
    },
  });

  const missing = targetSlugs.filter((slug) => !models.some((m) => m.slug === slug));
  if (missing.length > 0) console.log(`Not in this database (nothing to do): ${missing.join(", ")}\n`);

  for (const m of models) {
    console.log(`${m.name} (${m.slug}, ${m.id})`);
    console.log(
      `  baselines: ${m._count.baselineSetups} (CASCADE-DELETED), fill drafts: ${m._count.setupFillDrafts} (cascade-deleted), ` +
        `calibrations: ${m._count.calibrations} (unlinked), documents: ${m._count.setupDocuments} (unlinked)`
    );
    if (m.cars.length === 0) {
      console.log("  cars: none");
    } else {
      console.log(`  cars: ${m.cars.length} — these keep their runs and data but lose the sheet link:`);
      for (const car of m.cars) {
        console.log(`    - "${car.name}" (${car.user?.email ?? "no owner email"})`);
      }
    }
  }

  if (!apply) {
    console.log(`\nDry run: ${models.length} model(s) would be deleted. Re-run with --apply.`);
    return;
  }

  const adminEmail = [...parseAuthAdminEmails()][0];
  const admin = adminEmail
    ? await prisma.user.findFirst({
        where: { email: { equals: adminEmail, mode: "insensitive" } },
        select: { id: true },
      })
    : null;

  console.log("");
  for (const m of models) {
    // Suppression before deletion, same order as the delete route: if this crashes between the
    // two, a suppressed-but-present row is harmless; a deleted-but-unsuppressed one gets reseeded.
    await suppressCatalogSlug(m.slug, admin?.id ?? null);
    await prisma.$transaction([
      prisma.car.updateMany({
        where: { setupSheetModelId: m.id },
        data: { setupSheetTemplate: null },
      }),
      prisma.setupSheetModel.delete({ where: { id: m.id } }),
    ]);
    console.log(`deleted  ${m.name} (${m.slug}) — suppression row written`);
  }
  invalidateAuthorizedSetupSheetCatalogCache();
  console.log("\nDone. Restart any running dev server to see the catalog without them.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
