import { trackHasMarkedLocation } from "@/lib/location/coordinates";

export type PromptMarkTrackLocation = {
  trackId: string;
  trackName: string;
};

export async function buildPromptMarkTrackLocation(params: {
  userId: string;
  trackId: string | null | undefined;
  loggingComplete: boolean;
  newlyCompleted: boolean;
  hasDismissedRunLocationPrompt: (userId: string, trackId: string) => Promise<boolean>;
  findTrack: (
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

  if (await params.hasDismissedRunLocationPrompt(params.userId, trackId)) {
    return null;
  }

  const track = await params.findTrack(trackId);
  if (!track || trackHasMarkedLocation(track)) return null;

  return { trackId: track.id, trackName: track.name };
}
