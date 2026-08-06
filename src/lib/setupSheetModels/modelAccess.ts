// `authAdminLogic`, not `authAdmin`: the latter is the same re-export behind a `server-only`
// guard, which makes these rules impossible to unit test. `catalogAccessLogic` does the same for
// the same reason. Pure module — no server imports.
import { isAuthAdminEmail } from "@/lib/authAdminLogic";
import { canManageCatalogRow, type CatalogAccessUser } from "@/lib/assets/catalogAccessLogic";

/**
 * Setup sheet models are global. Only an admin — or the creator while the model is still
 * unauthorized — may edit a shared model's name/schema or delete it. Authorizing is admin-only.
 * Single source of truth for the API route and the schema editor page.
 *
 * OPTIMISTIC: this is the right rule for deciding whether to *show* an edit affordance, and it is
 * what `/setup-sheet-models/[id]/schema` gates on. It deliberately does not know whether anyone
 * else depends on the model — for anything destructive use `canManageSetupSheetModel` below.
 */
export function canEditSetupSheetModel(
  user: { id: string; email: string | null },
  model: { userId: string | null; isAuthorized: boolean }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  return model.userId === user.id && !model.isAuthorized;
}

/** Dependants on a chassis type that belong to somebody other than the person acting. */
export type SetupSheetModelUsage = {
  /** Cars owned by another driver pointing at this model. */
  otherUserCars: number;
  /** Sequential-fill drafts owned by another driver. */
  otherUserFillDrafts: number;
  /** Uploaded sheets owned by another driver. */
  otherUserDocuments: number;
  /** Calibrations owned by another driver. */
  otherUserCalibrations: number;
  /** Published baselines. Admin-authored and global, so any at all counts as someone else's. */
  baselineSetups: number;
};

export function setupSheetModelUsedByOthers(usage: SetupSheetModelUsage): boolean {
  return (
    usage.otherUserCars > 0 ||
    usage.otherUserFillDrafts > 0 ||
    usage.otherUserDocuments > 0 ||
    usage.otherUserCalibrations > 0 ||
    usage.baselineSetups > 0
  );
}

/**
 * May this user DELETE this chassis type, or rewrite its parameter list?
 *
 * The distinction from `canEditSetupSheetModel` is not cosmetic. `Car.setupSheetModelId` is
 * `onDelete: SetNull` and both `BaselineSetup` and `SetupFillDraft` are `onDelete: Cascade`, so
 * deleting a model another driver adopted silently unlinks their car and destroys the fill draft
 * they had parked mid-session. While chassis types could only be created by an admin that was
 * unreachable; the moment a driver can author one and it goes live for everyone, it is one tap.
 *
 * Rewriting the schema is the same class of harm by a slower route: the stored JSON survives, but
 * values under renamed keys stop rendering, so another driver's saved sheet quietly empties.
 *
 * Delegates to the unified catalog rule that tracks, tire types and additive types already use —
 * whose own doc has always named chassis (`verified` = `isAuthorized` here) as one of its cases.
 */
export function canManageSetupSheetModel(
  user: CatalogAccessUser,
  model: { userId: string | null; isAuthorized: boolean },
  usage: SetupSheetModelUsage
): boolean {
  return canManageCatalogRow(user, {
    creatorUserId: model.userId,
    verified: model.isAuthorized,
    usedByOthers: setupSheetModelUsedByOthers(usage),
  });
}
