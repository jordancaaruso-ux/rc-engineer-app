import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { trackCatalogScopeWhere } from "@/lib/tracks/communityTrackAccess";
import { TrackList } from "@/components/tracks/TrackList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

/** Favourites + global track list — revalidated on track mutations. */
export const revalidate = 30;

export default async function TracksPage({
  searchParams,
}: {
  /**
   * `?trackId=…` — the Paddock tracks band has always linked here with an id and nothing
   * read it, so tapping a track you race at landed you at the top of a catalog of hundreds
   * with that track nowhere on screen. `TrackList` opens the row and scrolls to it.
   */
  searchParams?: Promise<{ trackId?: string | string[] }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/paddock" />
            <div>
              <h1 className="page-title">Tracks</h1>
              <p className="page-subtitle">Database not configured.</p>
            </div>
          </div>
        </header>
        <section className="page-body">
          <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage tracks.
          </CardPanel>
        </section>
      </>
    );
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const focusTrackId =
    typeof resolvedSearchParams.trackId === "string" && resolvedSearchParams.trackId.trim()
      ? resolvedSearchParams.trackId.trim()
      : null;

  const user = await requireCurrentUser();
  const scope = trackCatalogScopeWhere(user);

  const TRACK_FIELDS = {
    id: true,
    name: true,
    location: true,
    countryCode: true,
    region: true,
    liveRcUrl: true,
    speedhiveUrl: true,
    gripTags: true,
    layoutTags: true,
    latitude: true,
    longitude: true,
  } as const;

  /*
   * The catalog is pre-seeded now — roughly 1,500 tracks rather than the few hundred this page
   * was written for. Loading every row and filtering them in the browser stopped being viable, and
   * an alphabetical list of 1,500 was never the thing a driver wanted anyway: they want their
   * favourites, the tracks near them, and a search box.
   *
   * So the server sends a first screen (favourites, then the countries this driver actually races
   * in) and `TrackList` asks the server for anything else. Nearby is fetched client-side, because
   * only the browser knows where the phone is.
   */
  const [favouriteTrackIds, catalogCount] = await Promise.all([
    getFavouriteTrackIdsForUser(user.id),
    prisma.track.count({ where: scope }),
  ]);

  // Which countries this driver races in — from their own favourites and runs, since nothing on
  // the User row records a country. Falls back to an unscoped first page for a brand-new driver.
  const ownTracks = await prisma.track.findMany({
    where: {
      ...scope,
      OR: [{ favouriteTracks: { some: { userId: user.id } } }, { runs: { some: { userId: user.id } } }],
    },
    select: { countryCode: true },
  });
  const homeCountries = [
    ...new Set(ownTracks.map((t) => t.countryCode).filter((c): c is string => !!c)),
  ];

  const BROWSE_LIMIT = 60;
  const [favouriteTracks, browseTracks, focusTrack] = await Promise.all([
    favouriteTrackIds.length > 0
      ? prisma.track.findMany({
          where: { ...scope, id: { in: favouriteTrackIds } },
          orderBy: { name: "asc" },
          select: TRACK_FIELDS,
        })
      : Promise.resolve([]),
    prisma.track.findMany({
      where: homeCountries.length > 0 ? { ...scope, countryCode: { in: homeCountries } } : scope,
      orderBy: { name: "asc" },
      take: BROWSE_LIMIT,
      select: TRACK_FIELDS,
    }),
    // `?trackId=…` must still open its row even when that track is nowhere in the first screen —
    // which, with a capped list, is now the common case rather than the rare one.
    focusTrackId
      ? prisma.track.findUnique({ where: { id: focusTrackId }, select: TRACK_FIELDS })
      : Promise.resolve(null),
  ]);

  const seen = new Set<string>();
  const sortedTracks = [...favouriteTracks, ...(focusTrack ? [focusTrack] : []), ...browseTracks].filter(
    (t) => (seen.has(t.id) ? false : (seen.add(t.id), true))
  );

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/paddock" />
          <div>
            <h1 className="page-title">Tracks</h1>
            <p className="page-subtitle">
              Search the community track catalog. Add a track only if you cannot find it.
            </p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl">
          <TrackList
            initialTracks={sortedTracks}
            favouriteTrackIds={favouriteTrackIds}
            focusTrackId={focusTrackId}
            catalogCount={catalogCount}
          />
        </div>
      </section>
    </>
  );
}
