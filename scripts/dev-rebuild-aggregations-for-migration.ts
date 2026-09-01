/**
 * Rebuild setup aggregations after the A800RR edition-snapshot migration — the same calls
 * POST /api/setup-aggregations/rebuild makes, for the two affected users plus community stats.
 */
import { prisma } from "@/lib/prisma";
import { rebuildSetupAggregationsForUserCars } from "@/lib/setupAggregations/rebuildCarParameterAggregations";
import { rebuildCommunityTemplateAggregations } from "@/lib/setupAggregations/rebuildCommunityTemplateAggregations";

async function main() {
  for (const email of ["jordancaaruso@gmail.com", "lucas.urbain@yahoo.fr"]) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
    if (!user) { console.log(`${email}: no account here`); continue; }
    const result = await rebuildSetupAggregationsForUserCars(user.id);
    console.log(`${email}: ${JSON.stringify(result).slice(0, 200)}`);
  }
  const community = await rebuildCommunityTemplateAggregations();
  console.log(`community: ${JSON.stringify(community).slice(0, 300)}`);
}

main().finally(() => prisma.$disconnect());
