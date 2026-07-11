/**
 * One-time repair: link cars that have no setup sheet model (`setupSheetModelId = null`) to the
 * authorized global model their name/chassis clearly identifies (e.g. a car named "MTC3" →
 * "Mugen MTC3"), so they stop falling back to the sparse generic setup sheet. Only unambiguous
 * matches link; genuinely custom/unknown cars are left alone.
 *
 * This heals data created before the add-car flow required a chassis-type pick. It is NOT wired
 * into the app's warm-start catalog seed on purpose — going forward, a null model means the user
 * explicitly chose "my chassis isn't listed yet" (pending), which we must not silently overwrite.
 *
 *   Dry-run: npx dotenv-cli -e .env.local -- npx tsx scripts/link-orphan-cars.ts
 *   Apply:   npx dotenv-cli -e .env.local -- npx tsx scripts/link-orphan-cars.ts --apply
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { templateKeyFromModelSlug } from "@/lib/setupSheetTemplateId";
import { pickAuthorizedModelIdForChassisText } from "@/lib/setupSheetModels/matchAuthorizedModel";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  console.log(`[link-orphans] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const authorized = await prisma.setupSheetModel.findMany({
    where: { isAuthorized: true },
    select: { id: true, name: true, isAuthorized: true, slug: true },
  });
  const orphans = await prisma.car.findMany({
    where: { setupSheetModelId: null },
    select: { id: true, name: true, chassis: true, user: { select: { email: true } } },
  });
  console.log(`Authorized models: ${authorized.length}. Null-model cars: ${orphans.length}.\n`);

  let linked = 0;
  for (const car of orphans) {
    const matchedId =
      pickAuthorizedModelIdForChassisText(car.chassis, authorized) ??
      pickAuthorizedModelIdForChassisText(car.name, authorized);
    const model = matchedId ? authorized.find((m) => m.id === matchedId) : null;
    if (!model) continue;
    linked++;
    console.log(`  LINK "${car.name}" chassis=${car.chassis ?? "-"} (${car.user?.email}) -> ${model.name} [${model.slug}]`);
    if (APPLY) {
      await prisma.car.update({
        where: { id: car.id },
        data: { setupSheetModelId: model.id, setupSheetTemplate: templateKeyFromModelSlug(model.slug) },
      });
    }
  }
  console.log(`\n${APPLY ? "Linked" : "Would link"} ${linked} of ${orphans.length}; ${orphans.length - linked} left unlinked (no confident match).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
