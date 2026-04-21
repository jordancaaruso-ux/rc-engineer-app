import { prisma } from "@/lib/prisma";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";

/**
 * Car rows that share the same setup sheet template (e.g. two A800RR builds) should share
 * downloaded setups and past-run pickers — same PDF schema / keys.
 */
export async function carIdsSharingSetupTemplate(userId: string, carId: string): Promise<string[]> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetTemplate: true },
  });
  if (!car) return [carId];
  const canonical = canonicalSetupSheetTemplateId(car.setupSheetTemplate ?? null);
  if (!canonical) return [carId];
  const rows = await prisma.car.findMany({
    where: {
      userId,
      setupSheetTemplate: { equals: canonical, mode: "insensitive" },
    },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
