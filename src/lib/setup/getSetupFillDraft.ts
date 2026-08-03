import { prisma } from "@/lib/prisma";

/**
 * DB reads for a parked sequential setup fill. Kept apart from `setupFillDraft.ts` so the pure
 * staleness helpers there stay unit-testable — `@/lib/prisma` builds a client at module load.
 */

/** Everything needed to resume, including the whole sheet. */
const RESUME_SELECT = {
  id: true,
  data: true,
  stepIndex: true,
  pendingText: true,
  pendingStepKey: true,
  name: true,
  updatedAt: true,
} as const;

export async function getSetupFillDraftForCar(userId: string, carId: string) {
  return prisma.setupFillDraft.findUnique({
    where: { userId_carId: { userId, carId } },
    select: RESUME_SELECT,
  });
}

export async function getSetupFillDraftForModel(userId: string, setupSheetModelId: string) {
  return prisma.setupFillDraft.findUnique({
    where: { userId_setupSheetModelId: { userId, setupSheetModelId } },
    select: RESUME_SELECT,
  });
}

/**
 * Progress and timestamp only — no `data`.
 *
 * For the car page's resume row, which has no template to recount against and shouldn't pay for a
 * whole sheet of JSON to render one line. These counts are the client's own last report, so they
 * can drift by a field or two if the chassis schema changed since — acceptable for a nav label
 * whose destination recomputes the truth from today's template.
 */
export async function getSetupFillDraftSummaryForCar(userId: string, carId: string) {
  return prisma.setupFillDraft.findUnique({
    where: { userId_carId: { userId, carId } },
    select: { answeredCount: true, stepCount: true, updatedAt: true },
  });
}
