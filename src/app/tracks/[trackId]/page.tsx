import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isTrackFavourite } from "@/lib/track-favourites";
import { hasDatabaseUrl } from "@/lib/env";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { TrackFavouriteClient } from "@/components/tracks/TrackFavouriteClient";
import { TrackLiveRcUrlEditor } from "@/components/tracks/TrackLiveRcUrlEditor";
import { TrackSpeedhiveUrlEditor } from "@/components/tracks/TrackSpeedhiveUrlEditor";
import { TrackLocationNotSetBanner } from "@/components/tracks/TrackLocationNotSetBanner";
import { TrackLocationEditor } from "@/components/tracks/TrackLocationEditor";
import { TrackDeleteClient } from "@/components/tracks/TrackDeleteClient";
import { TrackMetaTagsEditor } from "@/components/tracks/TrackMetaTagsEditor";
import { canManageCommunityTrack } from "@/lib/tracks/trackAccess";

export default async function TrackDetailPage(props: {
  params: Promise<{ trackId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/tracks" />
            <div>
              <h1 className="page-title">Track</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view tracks.
          </CardPanel>
        </section>
      </>
    );
  }

  const { trackId } = await props.params;
  const user = await requireCurrentUser();
  const track = await prisma.track.findFirst({
    where: { id: trackId },
    select: {
      id: true,
      name: true,
      location: true,
      liveRcUrl: true,
      speedhiveUrl: true,
      gripTags: true,
      layoutTags: true,
      createdAt: true,
      latitude: true,
      longitude: true,
      locationSource: true,
      userId: true,
    },
  });

  if (!track) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/tracks" />
            <div>
              <h1 className="page-title">Track</h1>
              <p className="page-subtitle">Not found.</p>
            </div>
          </div>
        </header>
      </>
    );
  }

  const [runCount, totalRunCount, eventCount, isFavourite] = await Promise.all([
    prisma.run.count({ where: { trackId, userId: user.id } }),
    prisma.run.count({ where: { trackId } }),
    prisma.event.count({ where: { trackId } }),
    isTrackFavourite(user.id, trackId),
  ]);
  const canManage = canManageCommunityTrack(user, track);
  const deleteAsAdmin = canManage && track.userId !== user.id;

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/tracks" />
          <div>
            <h1 className="page-title">{track.name}</h1>
            <p className="page-subtitle">Track details. Add or remove from your favourites.</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          <CardPanel contentClassName="text-sm">
            <div className="grid gap-2">
              <div><span className="text-sm font-medium text-muted-foreground">Created</span> <span className="ml-2">{formatRunCreatedAtDateTime(track.createdAt)}</span></div>
              <div><span className="text-sm font-medium text-muted-foreground">Runs</span> <span className="ml-2">{runCount}</span></div>
              {track.location ? (
                <div><span className="text-sm font-medium text-muted-foreground">Location</span> <span className="ml-2">{track.location}</span></div>
              ) : null}
            </div>
          </CardPanel>

          {!canManage ? (
            <p className="text-xs text-muted-foreground leading-snug">
              Only the user who added this track or an admin can edit metadata (GPS, tags, timing URLs).
              Your runs at this venue: {runCount}.
            </p>
          ) : null}

          {canManage ? (
            <>
              <TrackLocationNotSetBanner
                trackId={track.id}
                trackName={track.name}
                location={track.location}
                initial={{ latitude: track.latitude, longitude: track.longitude, locationSource: track.locationSource }}
                showCurrentLocation
              />

              <CardPanel contentClassName="text-sm">
                <Eyebrow className="mb-2">GPS location</Eyebrow>
                <TrackLocationEditor
                  trackId={track.id}
                  trackName={track.name}
                  location={track.location}
                  initial={{ latitude: track.latitude, longitude: track.longitude, locationSource: track.locationSource }}
                  showCurrentLocation
                />
              </CardPanel>

              <TrackMetaTagsEditor
                trackId={track.id}
                initialGripTags={track.gripTags}
                initialLayoutTags={track.layoutTags}
              />

              <TrackLiveRcUrlEditor trackId={track.id} initialLiveRcUrl={track.liveRcUrl} />

              <TrackSpeedhiveUrlEditor trackId={track.id} initialSpeedhiveUrl={track.speedhiveUrl} />
            </>
          ) : (
            <CardPanel contentClassName="text-sm text-muted-foreground">
              GPS, grip/layout tags, and timing URLs are managed by the user who added this track.
            </CardPanel>
          )}

          <TrackFavouriteClient trackId={track.id} trackName={track.name} isFavourite={isFavourite} />

          {canManage ? (
            <TrackDeleteClient
              trackId={track.id}
              trackName={track.name}
              runCount={totalRunCount}
              eventCount={eventCount}
              asAdmin={deleteAsAdmin}
            />
          ) : (
            <p className="text-xs text-muted-foreground leading-snug">
              Only the user who added this track or an admin can delete it. Your runs at this venue: {runCount}.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

