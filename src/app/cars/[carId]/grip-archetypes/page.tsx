import type { ReactNode } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupData, type SetupSnapshotData } from "@/lib/runSetup";
import { GripArchetypesClient } from "@/components/setup/GripArchetypesClient";

export default async function CarGripArchetypesPage(props: {
  params: Promise<{ carId: string }>;
}): Promise<ReactNode> {
  if (!hasDatabaseUrl()) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Grip archetypes</h1>
            <p className="page-subtitle">Database not configured.</p>
          </div>
        </header>
      </>
    );
  }

  const user = await requireCurrentUser();
  const { carId } = await props.params;

  const car = await prisma.car.findFirst({
    where: { id: carId, userId: user.id },
    select: { id: true, name: true, setupSheetTemplate: true },
  });

  if (!car) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Grip archetypes</h1>
            <p className="page-subtitle">Car not found.</p>
          </div>
          <Link
            href="/cars"
            className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
          >
            Back
          </Link>
        </header>
      </>
    );
  }

  const setupSheetTemplate = car.setupSheetTemplate?.trim() || null;

  // Most recent run with a setup snapshot — gives a "your setup" column on the comparison table.
  const latestRunWithSetup = await prisma.run.findFirst({
    where: { userId: user.id, carId: car.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      setupSnapshotId: true,
    },
  });
  const latestSnapshot = latestRunWithSetup?.setupSnapshotId
    ? await prisma.setupSnapshot.findUnique({
        where: { id: latestRunWithSetup.setupSnapshotId },
        select: { data: true },
      })
    : null;

  const snapshotRaw = latestSnapshot?.data ?? null;
  const snapshot = normalizeSetupData(snapshotRaw as SetupSnapshotData | null);
  const yourSetupRow: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (v == null) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      yourSetupRow[k] = v;
    } else if (typeof v === "string") {
      yourSetupRow[k] = v;
    } else if (Array.isArray(v)) {
      yourSetupRow[k] = v.filter((x) => typeof x === "string").join(", ");
    }
  }
  const yourSurface =
    typeof snapshot.track_surface === "string"
      ? snapshot.track_surface.trim().toLowerCase()
      : null;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Grip archetypes</h1>
          <p className="page-subtitle">
            {car.name}
            {setupSheetTemplate ? ` · ${setupSheetTemplate}` : " · no setup template set"}
          </p>
        </div>
        <Link
          href={`/cars/${car.id}`}
          className="rounded-md border border-border bg-card px-4 py-2 text-xs hover:bg-muted transition"
        >
          Back to car
        </Link>
      </header>
      <section className="page-body">
        {setupSheetTemplate == null ? (
          <div className="max-w-2xl rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground">
            This car has no <code className="font-mono">setupSheetTemplate</code> set, so the community archetypes can&apos;t be
            looked up. Open the car page and assign the template first.
          </div>
        ) : (
          <GripArchetypesClient
            carId={car.id}
            carName={car.name}
            setupSheetTemplate={setupSheetTemplate}
            defaultSurface={
              yourSurface === "asphalt" || yourSurface === "carpet"
                ? yourSurface
                : "asphalt"
            }
            yourSetup={yourSetupRow}
            latestRun={
              latestRunWithSetup
                ? {
                    runId: latestRunWithSetup.id,
                    createdAtIso: latestRunWithSetup.createdAt.toISOString(),
                  }
                : null
            }
          />
        )}
      </section>
    </>
  );
}
