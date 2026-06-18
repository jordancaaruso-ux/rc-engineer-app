import "server-only";

import type { Prisma } from "@prisma/client";
import { isAuthAdminEmail } from "@/lib/authAdmin";

export type CalibrationAccessUser = {
  id: string;
  email: string | null;
};

/**
 * Setup sheet calibrations are globally visible and applicable to every authenticated user
 * (not scoped to owner or `communityShared`).
 */
export function calibrationsVisibleToUserWhere(
  _userId?: string
): Prisma.SetupSheetCalibrationWhereInput {
  return {};
}

export function calibrationReadableByIdWhere(
  id: string
): Prisma.SetupSheetCalibrationWhereInput {
  return { id };
}

export function isCalibrationAdmin(user: CalibrationAccessUser): boolean {
  return isAuthAdminEmail(user.email);
}

/** True when the user may edit or delete this calibration (creator or admin). */
export function canManageCalibration(
  user: CalibrationAccessUser,
  calibration: { userId: string }
): boolean {
  return isCalibrationAdmin(user) || calibration.userId === user.id;
}

export function calibrationsEditableByUserWhere(
  user: CalibrationAccessUser,
  id: string
): Prisma.SetupSheetCalibrationWhereInput {
  if (isCalibrationAdmin(user)) return { id };
  return { id, userId: user.id };
}

/** Setup documents readable when serving calibration example PDFs. */
export function setupDocumentReadableForCalibrationExampleWhere(
  userId: string,
  docId: string
): Prisma.SetupDocumentWhereInput {
  return {
    id: docId,
    OR: [{ userId }, { exampleForCalibrations: { some: {} } }],
  };
}

/** Example PDFs linkable to a calibration the user is allowed to edit. */
export function setupDocumentLinkableAsCalibrationExampleWhere(
  user: CalibrationAccessUser,
  docId: string
): Prisma.SetupDocumentWhereInput {
  if (isCalibrationAdmin(user)) return { id: docId };
  return { id: docId, userId: user.id };
}
