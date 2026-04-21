import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import {
  computeSetupDeltaForAudit,
  resolveSetupSnapshot,
} from "@/lib/setup/resolveSetupSnapshot";

/**
 * Partial setup-snapshot save for an existing run, invoked by the "Save setup
 * snapshot to this run" button in the expanded Setup view. Creates a new
 * `SetupSnapshot` that merges the client-provided `setupData` onto the run's
 * current snapshot (acting as baseline for the audit delta), re-points
 * `Run.setupSnapshotId` at it, and returns the persisted snapshot.
 *
 * Intentionally decoupled from `POST /api/runs` so the UI can re-baseline a
 * run's setup mid-logging without having to re-submit the rest of the run
 * body (session type, tire / battery, laps, notes, handling assessment…).
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const user = await getAuthenticatedApiUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const existing = await prisma.run.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      carId: true,
      setupSnapshotId: true,
      setupSnapshot: { select: { id: true, data: true } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  let body: { setupData?: unknown } = {};
  try {
    body = (await request.json()) as { setupData?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const incoming =
    body.setupData && typeof body.setupData === "object" && !Array.isArray(body.setupData)
      ? (body.setupData as Record<string, unknown>)
      : null;
  if (!incoming) {
    return NextResponse.json({ error: "setupData is required" }, { status: 400 });
  }

  // Use the run's current snapshot (if any) as the baseline for delta audit so the
  // new snapshot row carries a meaningful `setupDeltaJson` + baseline link. When
  // there's no prior snapshot we just persist the incoming data directly.
  const baseline: SetupSnapshotData | null = existing.setupSnapshot
    ? normalizeSetupSnapshotForStorage(existing.setupSnapshot.data)
    : null;
  const resolved: SetupSnapshotData = baseline
    ? resolveSetupSnapshot(baseline, incoming)
    : normalizeSetupSnapshotForStorage(incoming);
  const audit = baseline ? computeSetupDeltaForAudit(baseline, resolved) : {};
  const deltaJson = Object.keys(audit).length > 0 ? audit : null;

  const created = await prisma.setupSnapshot.create({
    data: {
      userId: user.id,
      carId: existing.carId,
      data: resolved as object,
      baseSetupSnapshotId: existing.setupSnapshot?.id ?? null,
      setupDeltaJson: deltaJson === null ? undefined : (deltaJson as object),
    },
    select: { id: true, data: true, createdAt: true },
  });

  await prisma.run.update({
    where: { id: existing.id },
    data: { setupSnapshotId: created.id },
  });

  revalidatePath("/runs/history");
  revalidatePath("/engineer");
  revalidatePath(`/runs/${existing.id}/edit`);

  return NextResponse.json({
    ok: true,
    snapshot: { id: created.id, data: created.data, createdAt: created.createdAt },
  });
}
