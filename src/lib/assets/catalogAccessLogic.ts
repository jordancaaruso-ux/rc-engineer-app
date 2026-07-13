import { isAuthAdminEmail } from "@/lib/authAdminLogic";

export type CatalogAccessUser = { id: string; email: string | null };

export type CatalogRowState = {
  /** Creator attribution (`userId` / `createdByUserId`). Null = seeded / no owner. */
  creatorUserId: string | null;
  /** Founder-verified (`verifiedAt != null` or, for chassis, `isAuthorized`). */
  verified: boolean;
  /** Another user already depends on this row (run / set / participation / document). */
  usedByOthers: boolean;
};

/**
 * Unified edit/delete rule for global catalog rows (tracks, tire types, additive types,
 * calibrations, chassis types). The creator may edit/delete while the row is unverified
 * AND unused by others; once verified, or once another user depends on it, only an admin
 * may manage it. See docs/ASSET_ACCESS_NORTH_STAR.md.
 */
export function canManageCatalogRow(
  user: CatalogAccessUser,
  row: CatalogRowState
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  if (row.verified) return false;
  if (row.usedByOthers) return false;
  return row.creatorUserId != null && row.creatorUserId === user.id;
}

/**
 * Optimistic gate for UI affordances only (do NOT enforce with this). Skips the
 * `usedByOthers` DB check, so it may show a manage button that the API then rejects
 * for an unverified-but-used row — an acceptable edge for list rendering.
 */
export function mightManageCatalogRow(
  user: CatalogAccessUser,
  row: { creatorUserId: string | null; verified: boolean }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  if (row.verified) return false;
  return row.creatorUserId != null && row.creatorUserId === user.id;
}
