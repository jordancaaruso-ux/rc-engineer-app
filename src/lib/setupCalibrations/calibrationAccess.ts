import type { Prisma } from "@prisma/client";

/**
 * Calibrations the current user may list, load, and apply to their setup documents: owned rows plus
 * community-shared calibrations (see `communityShared` on SetupSheetCalibration).
 */
export function calibrationsVisibleToUserWhere(userId: string): Prisma.SetupSheetCalibrationWhereInput {
  return { OR: [{ userId }, { communityShared: true }] };
}

/**
 * `findFirst` / update target for a calibration the current user is allowed to **edit** (own only).
 */
export function calibrationsOwnedByUserWhere(
  userId: string,
  id: string
): Prisma.SetupSheetCalibrationWhereInput {
  return { id, userId };
}
