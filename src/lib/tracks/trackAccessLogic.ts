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
