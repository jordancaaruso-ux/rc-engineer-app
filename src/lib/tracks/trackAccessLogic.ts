import { isAuthAdminEmail } from "@/lib/authAdminLogic";

export type TrackAccessUser = {
  id: string;
  email: string | null;
};

/** Creator or app admin may edit community track metadata or delete the row. */
export function canManageCommunityTrack(
  user: TrackAccessUser,
  track: { userId: string }
): boolean {
  return track.userId === user.id || isAuthAdminEmail(user.email);
}

/** True when the user may delete this track (creator or admin). */
export function canDeleteTrack(
  user: TrackAccessUser,
  track: { userId: string }
): boolean {
  return canManageCommunityTrack(user, track);
}

/**
 * A LiveRC catalog row IS its URL, and that is the one track field a driver may not touch.
 *
 * `scripts/track-catalog/import-catalog.ts` writes `liveRcUrl` and `catalogSourceRef` from the
 * same fact — the club's LiveRC host — and the unique `(catalogSource, catalogSourceRef)` pair
 * is what makes re-running the import an update rather than a second copy of the catalog.
 * Repoint that URL and the row quietly stops being the club it names, taking lap import with it
 * for everyone watching that track. A wrong one is fixed at the source (a re-import) or by an
 * admin, never by a driver.
 *
 * Everything else on a track is a CONTRIBUTION and open to any driver: grip and layout tags,
 * the pin, the Speedhive link, and the LiveRC link on a track a user made themselves — none of
 * those are identity. Founder call 2026-09-18: a contribution nobody can correct is a worse
 * flaw than one anybody can change, so "add but never overwrite" was rejected. A new named
 * layout joined them 2026-09-26 (`trackLayouts.ts`): any driver adds one, from Log run.
 */
export function canEditLiveRcUrl(
  user: TrackAccessUser,
  track: { catalogSource: string | null }
): boolean {
  if (isAuthAdminEmail(user.email)) return true;
  return track.catalogSource !== "liverc";
}
