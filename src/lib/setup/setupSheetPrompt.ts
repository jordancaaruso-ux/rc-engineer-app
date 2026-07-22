import "server-only";

import { prisma } from "@/lib/prisma";
import { setupSheetModelIdsSupportingUpload } from "@/lib/setupCalibrations/carSupportsSheetUpload";
import type { UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";

/**
 * "You have no setup yet" prompt — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Replaces the set-up wizard's old sheet step (founder 2026-07-22): building a
 * setup during onboarding is too much work before the first run, but a car with
 * no setup is the single biggest hole in what the Engineer can say. So the ask
 * moves to the dashboard, has no Ignore, and retires itself the moment a setup
 * exists — same "derived from what they have" rule as the resume card.
 */

export type SetupSheetPrompt = {
  /** Cars to offer in the create/upload flow, newest first. */
  cars: UploadSetupCar[];
};

/**
 * What counts as "they have a setup": a named library setup, or one created by
 * reading an uploaded sheet. Per-run snapshots deliberately don't count — every
 * logged run writes one, so counting them would silence the prompt after run 1
 * for someone who has never entered a single value.
 */
export async function userHasAnySetup(userId: string): Promise<boolean> {
  const existing = await prisma.setupSnapshot.findFirst({
    where: {
      userId,
      OR: [{ isLibrary: true }, { sourceDocuments: { some: {} } }],
    },
    select: { id: true },
  });
  return existing != null;
}

/**
 * Null when there's nothing to ask for — no cars, or a setup already exists.
 * Ordered cheapest-query-first so the common case (Jordan, who has setups) costs
 * one indexed lookup.
 */
export async function loadSetupSheetPrompt(userId: string): Promise<SetupSheetPrompt | null> {
  if (await userHasAnySetup(userId)) return null;

  const cars = await prisma.car.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      setupSheetModelId: true,
      setupSheetModel: { select: { name: true } },
    },
    take: 25,
  });
  if (cars.length === 0) return null;

  // Same green-lit rule as the Garage hub: it only decides which door a car
  // opens (read a sheet vs fill one in), never whether we ask.
  const uploadableModelIds = await setupSheetModelIdsSupportingUpload(
    cars.map((c) => c.setupSheetModelId)
  );

  return {
    cars: cars.map((c) => ({
      id: c.id,
      name: c.name,
      chassisName: c.setupSheetModel?.name ?? null,
      supportsUpload: Boolean(c.setupSheetModelId && uploadableModelIds.has(c.setupSheetModelId)),
    })),
  };
}
