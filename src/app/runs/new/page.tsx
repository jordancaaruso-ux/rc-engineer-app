import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { getOrCreateLocalUser } from "@/lib/currentUser";
import { getFavouriteTrackIdsForUser } from "@/lib/track-favourites";
import { NewRunForm } from "@/components/runs/NewRunForm";
import { hasDatabaseUrl } from "@/lib/env";
import { getDashboardNewRunPrefill } from "@/lib/dashboardServer";

export default async function NewRunPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Log your run</h1>
            <p className="page-subtitle">Database not configured yet.</p>
          </div>
        </header>
        <section className="page-body">
          <div className="max-w-3xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Set <span className="font-mono">DATABASE_URL</span> in a{" "}
            <span className="font-mono">.env</span> file (Postgres) to enable
            saving runs.
          </div>
        </section>
      </>
    );
  }

  const user = await getOrCreateLocalUser();
  const sp = await searchParams;
  const dashboardPrefill = await getDashboardNewRunPrefill(user.id, sp);

  const [cars, allTracks, favouriteTrackIds] = await Promise.all([
    prisma.car.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, setupSheetTemplate: true },
    }),
    prisma.track.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, location: true },
    }),
    getFavouriteTrackIdsForUser(user.id),
  ]);

  const favSet = new Set(favouriteTrackIds);
  const favouriteTracks = allTracks.filter((t) => favSet.has(t.id));
  const tracks = allTracks;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Log your run</h1>
          <p className="page-subtitle">
            Trackside-fast logging. Optionally copy your last run for this car, or load a past setup only.
          </p>
        </div>
      </header>
      <section className="page-body">
        <NewRunForm
          cars={cars}
          tracks={tracks}
          favouriteTrackIds={favouriteTrackIds}
          favouriteTracks={favouriteTracks}
          dashboardPrefill={dashboardPrefill}
        />
      </section>
    </>
  );
}

