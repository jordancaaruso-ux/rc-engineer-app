import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { isTrackFavourite } from "@/lib/track-favourites";
import { hasDatabaseUrl } from "@/lib/env";
import Link from "next/link";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { TrackFavouriteClient } from "@/components/tracks/TrackFavouriteClient";

export default async function TrackDetailPage(props: {
  params: Promise<{ trackId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Track</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set DATABASE_URL in .env to view tracks.
          </div>
        </section>
      </>
    );
  }

  const { trackId } = await props.params;
  const user = await requireCurrentUser();
  const track = await prisma.track.findFirst({
    where: { id: trackId, userId: user.id },
    select: { id: true, name: true, location: true, createdAt: true },
  });

  if (!track) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Track</h1>
            <p className="page-subtitle">Not found.</p>
          </div>
          <Link
            href="/tracks"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back
          </Link>
        </header>
      </>
    );
  }

  const [runCount, isFavourite] = await Promise.all([
    prisma.run.count({ where: { trackId, userId: user.id } }),
    isTrackFavourite(user.id, trackId),
  ]);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">{track.name}</h1>
          <p className="page-subtitle">Track details. Add or remove from your favourites.</p>
        </div>
        <Link
          href="/tracks"
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back
        </Link>
      </header>
      <section className="page-body">
        <div className="max-w-2xl space-y-4">
          <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
            <div className="grid gap-2">
              <div><span className="text-sm font-medium text-muted-foreground">Created</span> <span className="ml-2">{formatRunCreatedAtDateTime(track.createdAt)}</span></div>
              <div><span className="text-sm font-medium text-muted-foreground">Runs</span> <span className="ml-2">{runCount}</span></div>
              {track.location ? (
                <div><span className="text-sm font-medium text-muted-foreground">Location</span> <span className="ml-2">{track.location}</span></div>
              ) : null}
            </div>
          </div>

          <TrackFavouriteClient trackId={track.id} trackName={track.name} isFavourite={isFavourite} />
        </div>
      </section>
    </>
  );
}

