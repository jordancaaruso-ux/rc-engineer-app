import { trackHasMarkedLocation } from "@/lib/location/coordinates";

export type PromptMarkTrackLocation = {
  trackId: string;
  trackName: string;
};

/**
 * Offer to pin GPS on the track after the user's first completed run there,
 * when the track has no saved coordinates yet.
 */
export async function buildPromptMarkTrackLocation(params: {
  userId: string;
  trackId: string | null | undefined;
  loggingComplete: boolean;
  /** True when this save newly marks the run complete (create or draft → complete). */
  newlyCompleted: boolean;
  countCompletedRunsAtTrack: (userId: string, trackId: string) => Promise<number>;
  findTrack: (
    userId: string,
    trackId: string
  ) => Promise<{
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  } | null>;
}): Promise<PromptMarkTrackLocation | null> {
  const trackId = params.trackId?.trim();
  if (!params.loggingComplete || !params.newlyCompleted || !trackId) return null;

  const track = await params.findTrack(params.userId, trackId);
  if (!track || trackHasMarkedLocation(track)) return null;

  const completedCount = await params.countCompletedRunsAtTrack(params.userId, trackId);
  if (completedCount !== 1) return null;

  return { trackId: track.id, trackName: track.name };
}
