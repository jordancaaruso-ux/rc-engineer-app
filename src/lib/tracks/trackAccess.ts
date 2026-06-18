import "server-only";

import { isAuthAdminEmail } from "@/lib/authAdmin";

export type TrackAccessUser = {
  id: string;
  email: string | null;
};

/** True when the user may delete this track (creator or admin). */
export function canDeleteTrack(
  user: TrackAccessUser,
  track: { userId: string }
): boolean {
  return track.userId === user.id || isAuthAdminEmail(user.email);
}
