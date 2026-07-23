import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { requireCurrentUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { TrackList } from "@/components/tracks/TrackList";
import { CardPanel } from "@/components/ui/CardPanel";
import { PageBackLink } from "@/components/ui/PageBackLink";

/** Favourites + global track list — revalidated on track mutations. */
export const revalidate = 30;

export default async function TracksPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <PageBackLink href="/assets" />
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

  const user = await requireCurrentUser();
  const [tracks, favouriteTrackIds] = await Promise.all([
    prisma.track.findMany({
      where: {},
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        location: true,
        liveRcUrl: true,
        speedhiveUrl: true,
        gripTags: true,
        layoutTags: true,
        latitude: true,
        longitude: true,
      },
    }),
    getFavouriteTrackIdsForUser(user.id),
  ]);

  const favSet = new Set(favouriteTrackIds);
  const sortedTracks = [...tracks].sort((a, b) => {
    const aFav = favSet.has(a.id);
    const bFav = favSet.has(b.id);
    if (aFav !== bFav) return aFav ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/assets" />
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
          <TrackList initialTracks={sortedTracks} favouriteTrackIds={favouriteTrackIds} />
        </div>
      </section>
    </>
  );
}
