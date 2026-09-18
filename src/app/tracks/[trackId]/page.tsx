import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isTrackFavourite } from "@/lib/track-favourites";
import { hasDatabaseUrl } from "@/lib/env";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { getExplicitTimeZoneForRunFormatting } from "@/lib/requestTimeZone";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { TrackFavouriteClient } from "@/components/tracks/TrackFavouriteClient";
import { TrackLiveRcUrlEditor } from "@/components/tracks/TrackLiveRcUrlEditor";
import { TrackSpeedhiveUrlEditor } from "@/components/tracks/TrackSpeedhiveUrlEditor";
import { TrackLocationEditor } from "@/components/tracks/TrackLocationEditor";
import { TrackDeleteClient } from "@/components/tracks/TrackDeleteClient";
import { TrackMetaTagsEditor } from "@/components/tracks/TrackMetaTagsEditor";
import { TrackLayoutsEditor } from "@/components/tracks/TrackLayoutsEditor";
import { TrackTimingLinks } from "@/components/tracks/TrackTimingLinks";
import { TrackTimingLinkFinder } from "@/components/tracks/TrackTimingLinkFinder";
import { canManageCommunityTrack } from "@/lib/tracks/trackAccess";
import { isAuthAdminEmail } from "@/lib/authAdmin";
import { UnverifiedBadge } from "@/components/assets/CatalogVerifyControl";
import { CatalogVerifyToggleButton } from "@/components/assets/CatalogVerifyToggleButton";

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
  const displayTimeZone = await getExplicitTimeZoneForRunFormatting();
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
      catalogSource: true,
      userId: true,
      verifiedAt: true,
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

  const [runCount, totalRunCount, eventCount, isFavourite, layouts] = await Promise.all([
    prisma.run.count({ where: { trackId, userId: user.id } }),
    prisma.run.count({ where: { trackId } }),
    prisma.event.count({ where: { trackId } }),
    isTrackFavourite(user.id, trackId),
    prisma.trackLayout.findMany({
      where: { trackId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, notes: true, sortOrder: true },
    }),
  ]);
  const canManage = canManageCommunityTrack(user, track);
  const deleteAsAdmin = canManage && track.userId !== user.id;
  const isAdmin = isAuthAdminEmail(user.email);
  /**
   * A LiveRC catalog row is defined by its URL, so that field states itself and offers nothing.
   * And where the pin came from LiveRC's published address there is nothing to set either — the
   * GPS card is one line. Both founder calls, 2026-09-18. A track a user added keeps every
   * control, whatever its timing links are: only a catalog row carries identity.
   */
  const liveRcIsIdentity = track.catalogSource === "liverc";
  const pinFromLiveRc = track.locationSource === "liverc_address";

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/tracks" />
          <div>
            <h1 className="page-title flex items-center gap-2">
              {track.name}
              {!track.verifiedAt ? <UnverifiedBadge /> : null}
            </h1>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="space-y-4">
          <CardPanel contentClassName="text-[13px]">
            <div className="grid gap-2">
              <div><span className="font-medium text-muted-foreground">Created</span> <span className="ml-2 fig-stat">{formatRunCreatedAtDateTime(track.createdAt, displayTimeZone)}</span></div>
              <div><span className="font-medium text-muted-foreground">Runs</span> <span className="ml-2 fig-stat">{runCount}</span></div>
              {track.location ? (
                <div><span className="font-medium text-muted-foreground">Location</span> <span className="ml-2">{track.location}</span></div>
              ) : null}
            </div>
          </CardPanel>

          {/* Admin verify toggle. Was an in-flow sibling of the `<h1>` in the header,
              which centres the title and the button as a PAIR — so the track name sat
              off-centre for an admin and centred for everyone else. */}
          {isAdmin ? (
            <div className="flex justify-end">
              <CatalogVerifyToggleButton
                endpoint={`/api/tracks/${track.id}`}
                verified={!!track.verifiedAt}
              />
            </div>
          ) : null}

          {/* Card order is the founder's, 2026-09-18: what the track IS first (grip and layout,
              then its layouts), then where its lap times come from (the timing links and the two
              URLs behind them), then the pin. Cards a driver may not edit are no longer grouped
              together, so each one carries its own `canManage` rather than sharing a block.

              Open to any driver (same call): tags, the Speedhive link and the pin are
              contributions, not identity — one driver's serves everyone racing here, and a
              contribution nobody but an admin can correct is a worse flaw than one anybody can
              change. That whole group used to sit behind `canManage`, which on a seeded catalog
              row means admin only, so nobody could fill in the 1,045 imported tracks. */}
          <TrackMetaTagsEditor
            trackId={track.id}
            initialGripTags={track.gripTags}
            initialLayoutTags={track.layoutTags}
          />

          {/* This track's own named layouts — still the creator's or an admin's list. */}
          {canManage ? <TrackLayoutsEditor trackId={track.id} initialLayouts={layouts} /> : null}

          {/* A track with neither link searches nothing and looks like a scan that found nothing.
              After the catalog seed that is most of the European rows, so the gap gets an ask
              rather than silence — any driver may donate the link, and one paste serves everyone
              racing here. */}
          {!track.liveRcUrl && !track.speedhiveUrl ? (
            <TrackTimingLinkFinder trackId={track.id} trackName={track.name} />
          ) : (
            <TrackTimingLinks liveRcUrl={track.liveRcUrl} speedhiveUrl={track.speedhiveUrl} />
          )}

          {/* Editable only where the address is not identity — `canEditLiveRcUrl` refuses the rest
              at the API, admins included, and `locked` says so on screen. */}
          {canManage ? (
            <TrackLiveRcUrlEditor
              trackId={track.id}
              initialLiveRcUrl={track.liveRcUrl}
              locked={liveRcIsIdentity}
            />
          ) : null}

          <TrackSpeedhiveUrlEditor trackId={track.id} initialSpeedhiveUrl={track.speedhiveUrl} />

          <CardPanel contentClassName="text-sm">
            <Eyebrow className="mb-2">GPS location</Eyebrow>
            <TrackLocationEditor
              trackId={track.id}
              trackName={track.name}
              location={track.location}
              initial={{ latitude: track.latitude, longitude: track.longitude, locationSource: track.locationSource }}
              showCurrentLocation
              readOnly={pinFromLiveRc}
            />
          </CardPanel>

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

