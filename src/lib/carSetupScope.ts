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

/** Canonical `setupSheetTemplate` for an owned car, or null. */
export async function canonicalSetupTemplateForUserCarId(
  userId: string,
  carId: string
): Promise<string | null> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: { setupSheetTemplate: true },
  });
  if (!car) return null;
  return canonicalSetupSheetTemplateId(car.setupSheetTemplate ?? null);
}

/** True if `targetCarId` is allowed when turning this document into a `SetupSnapshot` (same type as upload, or legacy sibling). */
export async function isCarValidTargetForSetupDocument(
  userId: string,
  doc: { carId: string | null; setupSheetTemplate: string | null },
  targetCarId: string
): Promise<boolean> {
  if (doc.setupSheetTemplate) {
    const t = await canonicalSetupTemplateForUserCarId(userId, targetCarId);
    return t === doc.setupSheetTemplate;
  }
  if (doc.carId) {
    const sib = await carIdsSharingSetupTemplate(userId, doc.carId);
    return sib.includes(targetCarId);
  }
  return true;
}
