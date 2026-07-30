import "server-only";

import { prisma } from "@/lib/prisma";
import { chassisPlatformLabel } from "@/lib/cars/carClasses";
import { platformForChassisSlug } from "@/lib/cars/chassisPlatform";
import { canonicalSetupSheetTemplateId } from "@/lib/setupSheetTemplateId";
import {
  formatGeneralCarIdentityLine,
  type GeneralCarIdentity,
} from "@/lib/engineerPhase5/engineerGeneralContext";

/**
 * Identity (never data) for the car a general question is scoped to. Ownership-scoped;
 * null for a missing/foreign car so general mode degrades to pure theory rather than
 * erroring. Platform comes from the chassis model slug, falling back to the driver-set
 * carClass when the chassis isn't in the curated catalog.
 */
export async function loadGeneralCarIdentity(
  userId: string,
  carId: string
): Promise<GeneralCarIdentity | null> {
  const car = await prisma.car.findFirst({
    where: { id: carId, userId },
    select: {
      id: true,
      name: true,
      chassis: true,
      carClass: true,
      setupSheetTemplate: true,
      setupSheetModel: { select: { slug: true } },
    },
  });
  if (!car) return null;
  const slug = car.setupSheetModel?.slug ?? canonicalSetupSheetTemplateId(car.setupSheetTemplate);
  const platformLabel = chassisPlatformLabel(platformForChassisSlug(slug) ?? car.carClass);
  const identity = {
    carId: car.id,
    name: car.name,
    chassis: car.chassis,
    platformLabel,
  };
  return { ...identity, line: formatGeneralCarIdentityLine(identity) };
}
