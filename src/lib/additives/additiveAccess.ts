import { isAuthAdminEmail } from "@/lib/authAdminLogic";

/**
 * What one driver may do with one additive in the shared list.
 *
 * - `admin` — anything: rename, delete, verify.
 * - `own` — they added it and no other driver uses it, so they may rename or delete it.
 * - `in-use` — they added it, but another driver's run or meeting uses it now, so it is locked.
 * - `none` — someone else's, or one of ours.
 *
 * The same "own item, nobody else uses it" rule as a track's Delete (founder call 2026-09-26,
 * after the launch test drive). Verification doesn't enter into it: every additive is trusted on
 * arrival since 2026-09-26, so keyed on `verifiedAt` the rule locked the maker out of their own
 * typo the moment they made it, and a lowercase "canowindra grip mix" sat in everyone's list.
 * Whether anyone else depends on the row is the protection that matters, and it is the one kept.
 */
export type AdditiveAccess = "admin" | "own" | "in-use" | "none";

/**
 * `usedByOthers`: another driver has the additive on a run or a meeting entry. The caller only
 * needs to look it up for the additive's own maker; for anyone else it doesn't change the answer.
 */
export function additiveAccess(
  user: { id: string; email: string | null },
  row: { createdByUserId: string | null },
  usedByOthers: boolean
): AdditiveAccess {
  if (isAuthAdminEmail(user.email)) return "admin";
  if (row.createdByUserId == null || row.createdByUserId !== user.id) return "none";
  return usedByOthers ? "in-use" : "own";
}

/** Rename or delete. */
export function canChangeAdditive(access: AdditiveAccess): boolean {
  return access === "admin" || access === "own";
}

/** Why a driver's own additive is locked; the API's refusal and the Additives page say the same. */
export const ADDITIVE_IN_USE_REASON = "Other racers use this, so you can’t rename or delete it.";
export const ADDITIVE_NOT_YOURS_REASON = "Only the racer who added this additive can change it.";
