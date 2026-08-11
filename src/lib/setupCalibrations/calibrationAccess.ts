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

/**
 * Calibrations eligible for cross-user AUTO-PICK: the user's own (verified or not, to unblock
 * their own uploads) plus any founder-verified calibration from another user. Unverified
 * calibrations belonging to other users are never auto-applied — a wrong mapping would silently
 * mis-parse every reuser's setup. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export function calibrationsAutoPickableByUserWhere(
  userId: string
): Prisma.SetupSheetCalibrationWhereInput {
  return { OR: [{ userId }, { verifiedAt: { not: null } }] };
}

export function isCalibrationAdmin(user: CalibrationAccessUser): boolean {
  return isAuthAdminEmail(user.email);
}

/**
 * Admin-authored calibrations are auto-trusted: stamped `verifiedAt` on create so they immediately
 * enter every user's cross-user auto-pick pool (see {@link calibrationsAutoPickableByUserWhere})
 * without a manual verify step. Non-admins get null (unverified until a founder verifies).
 */
export function verifiedAtForNewCalibration(creator: CalibrationAccessUser): Date | null {
  return isCalibrationAdmin(creator) ? new Date() : null;
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

/**
 * The same, plus the one file an admin needs to work the upload review queue.
 *
 * A sheet that could not be turned into a chassis — a flat PDF, or one nothing could be read from —
 * is kept precisely so the founder can make it fillable himself. It belongs to the driver who
 * uploaded it and it is attached to no calibration, so the rule above hides it from the only person
 * who can act on it.
 *
 * Deliberately narrow: an admin gets a driver's setup PDF only when that driver uploaded it AS a
 * setup sheet and the app told them it could not be used. A sheet that worked is already readable,
 * because it became the chassis's example document.
 */
export function setupDocumentReadableForReviewWhere(
  user: CalibrationAccessUser,
  docId: string
): Prisma.SetupDocumentWhereInput {
  const base = setupDocumentReadableForCalibrationExampleWhere(user.id, docId);
  if (!isCalibrationAdmin(user)) return base;
  return {
    id: docId,
    OR: [
      ...((base.OR ?? []) as Prisma.SetupDocumentWhereInput[]),
      { blankSheet: { is: { status: { not: "FILLABLE" } } } },
    ],
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
