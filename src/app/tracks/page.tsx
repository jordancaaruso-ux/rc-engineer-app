import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { TrackList } from "@/components/tracks/TrackList";

export default async function TracksPage(): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Tracks</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to manage tracks.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const [tracks, favouriteTrackIds] = await Promise.all([
    prisma.track.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, location: true },
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
        <div>
          <h1 className="page-title">Tracks</h1>
          <p className="page-subtitle">
            Add and manage tracks. Use them when logging runs or creating events.
          </p>
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
