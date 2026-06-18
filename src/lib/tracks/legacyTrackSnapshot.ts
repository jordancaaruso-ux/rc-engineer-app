import "server-only";

import { prisma } from "@/lib/prisma";

export type LegacyTrackSnapshot = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
  gripTags: string[];
  layoutTags: string[];
  archivedAt: string;
};

type TrackRowForLegacy = {
  id: string;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
  gripTags: string[];
  layoutTags: string[];
};

export function legacyTrackSnapshotFromRow(track: TrackRowForLegacy): LegacyTrackSnapshot {
  return {
    id: track.id,
    name: track.name,
    location: track.location,
    latitude: track.latitude,
    longitude: track.longitude,
    liveRcUrl: track.liveRcUrl,
    speedhiveUrl: track.speedhiveUrl,
    gripTags: track.gripTags,
    layoutTags: track.layoutTags,
    archivedAt: new Date().toISOString(),
  };
}

export function trackSnapshotFieldsFromRow(track: TrackRowForLegacy): {
  trackNameSnapshot: string;
  trackLocationSnapshot: string | null;
  legacyTrackJson: LegacyTrackSnapshot;
} {
  return {
    trackNameSnapshot: track.name,
    trackLocationSnapshot: track.location,
    legacyTrackJson: legacyTrackSnapshotFromRow(track),
  };
}

type EventTrackDisplay = {
  track?: { name: string; location?: string | null } | null;
  trackNameSnapshot?: string | null;
  trackLocationSnapshot?: string | null;
};

export function resolveEventTrackName(event: EventTrackDisplay): string | null {
  const live = event.track?.name?.trim();
  if (live) return live;
  const snap = event.trackNameSnapshot?.trim();
  return snap || null;
}

export function resolveEventTrackLocation(event: EventTrackDisplay): string | null {
  const live = event.track?.location?.trim();
  if (live) return live;
  const snap = event.trackLocationSnapshot?.trim();
  return snap || null;
}

export function resolveEventTrackLabel(event: EventTrackDisplay): string | null {
  const name = resolveEventTrackName(event);
  if (!name) return null;
  const location = resolveEventTrackLocation(event);
  return location ? `${name} (${location})` : name;
}

export function isLegacyEventTrack(event: {
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
  legacyTrackJson?: unknown;
}): boolean {
  return !event.track && Boolean(event.trackNameSnapshot?.trim() || event.legacyTrackJson);
}

const TRACK_LEGACY_SELECT = {
  id: true,
  name: true,
  location: true,
  latitude: true,
  longitude: true,
  liveRcUrl: true,
  speedhiveUrl: true,
  gripTags: true,
  layoutTags: true,
} as const;

/** Fields to set when linking an event to a live catalog track. */
export async function eventTrackFieldsForLink(trackId: string): Promise<{
  trackNameSnapshot: string;
  trackLocationSnapshot: string | null;
  legacyTrackJson: null;
} | null> {
  const track = await prisma.track.findFirst({
    where: { id: trackId },
    select: { name: true, location: true },
  });
  if (!track) return null;
  return {
    trackNameSnapshot: track.name,
    trackLocationSnapshot: track.location,
    legacyTrackJson: null,
  };
}

/** Copy track catalog fields onto events/runs before deleting the Track row. */
export async function archiveTrackLegacyDataBeforeDelete(trackId: string): Promise<void> {
  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: TRACK_LEGACY_SELECT,
  });
  if (!track) return;

  const snapshots = trackSnapshotFieldsFromRow(track);

  await prisma.$transaction([
    prisma.event.updateMany({
      where: { trackId },
      data: {
        trackNameSnapshot: snapshots.trackNameSnapshot,
        trackLocationSnapshot: snapshots.trackLocationSnapshot,
        legacyTrackJson: snapshots.legacyTrackJson,
      },
    }),
    prisma.run.updateMany({
      where: { trackId, OR: [{ trackNameSnapshot: null }, { trackNameSnapshot: "" }] },
      data: { trackNameSnapshot: track.name },
    }),
  ]);
}
