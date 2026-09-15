import "server-only";

import { prisma } from "@/lib/prisma";
import { resolveTrackTimeZone, timeZoneForCoordinates } from "@/lib/tracks/trackTimeZone";

/**
 * Read a track's zone, writing it back once when the column is empty but the pin can answer.
 * Cheap on the steady state (one select); the write happens at most once per track.
 */
export async function ensureTrackTimeZone(trackId: string): Promise<string> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: {
      timeZone: true,
      latitude: true,
      longitude: true,
      user: { select: { timeZone: true } },
    },
  });
  if (!track) return resolveTrackTimeZone({});
  if (!track.timeZone) {
    const fromPin = timeZoneForCoordinates(track.latitude, track.longitude);
    if (fromPin) {
      await prisma.track.update({ where: { id: trackId }, data: { timeZone: fromPin } });
      return fromPin;
    }
  }
  return resolveTrackTimeZone(track, track.user);
}
