import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";

/**
 * The car's setup library: named, reusable setups (`SetupSnapshot.isLibrary`).
 *
 * Deliberately separate from the per-run snapshots `/api/runs` creates — those stay
 * `isLibrary: false` and keep flowing into aggregations through their run. Library rows have no
 * run, so they are invisible to `rebuildCarParameterAggregations` (which iterates runs) and to
 * `rebuildCommunityTemplateAggregations` (which iterates documents). Nothing here changes what
 * the community pool sees.
 */

const MAX_NAME_LENGTH = 80;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

/** List the current user's library setups for a car. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const carId = new URL(request.url).searchParams.get("carId")?.trim();
  if (!carId) return NextResponse.json({ error: "carId is required" }, { status: 400 });

  const setups = await prisma.setupSnapshot.findMany({
    where: { userId: userId, carId, isLibrary: true },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      data: true,
      _count: { select: { runs: true, derivedSnapshots: true } },
    },
  });

  return NextResponse.json({
    setups: setups.map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt.toISOString(),
      data: s.data,
      // Runs logged straight off this row, plus runs whose snapshot was derived from it.
      usedInRuns: s._count.runs + s._count.derivedSnapshots,
    })),
  });
}

/** Create a named library setup on a car. */
export async function POST(request: Request): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const carId = typeof body.carId === "string" ? body.carId.trim() : "";
  if (!carId) return NextResponse.json({ error: "carId is required" }, { status: 400 });

  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "A setup name is required" }, { status: 400 });

  // Ownership check: a library setup only ever hangs off the requester's own car.
  const car = await prisma.car.findFirst({
    where: { id: carId, userId: userId },
    select: { id: true, setupSheetModelId: true },
  });
  if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 });

  const baseId = typeof body.baseSetupSnapshotId === "string" ? body.baseSetupSnapshotId.trim() : "";
  if (baseId) {
    const base = await prisma.setupSnapshot.findFirst({
      where: { id: baseId, userId: userId },
      select: { id: true },
    });
    if (!base) return NextResponse.json({ error: "Baseline setup not found" }, { status: 400 });
  }

  // "Save as baseline" on an existing setup (a run's, a sheet's): the server reads the source
  // values so the client never has to ship the whole sheet back to us.
  const fromId =
    typeof body.fromSetupSnapshotId === "string" ? body.fromSetupSnapshotId.trim() : "";
  let sourceData: unknown = body.data;
  if (fromId) {
    const source = await prisma.setupSnapshot.findFirst({
      where: { id: fromId, userId: userId },
      select: { data: true },
    });
    if (!source) return NextResponse.json({ error: "Setup not found" }, { status: 404 });
    sourceData = source.data;
  }

  /**
   * Adopting a global baseline. Copy, never reference: the driver owns these values from here on,
   * so an admin editing or deleting the baseline can't rewrite their setup. The link is kept for
   * the "from Kit setup" label only.
   *
   * Two callers, one field. "Save a copy" on the car page sends no `data`, so the baseline's values
   * are read here. The New Setup flow sends the sheet the driver just edited — those win, and the
   * baseline id records only where they started.
   */
  const fromBaselineId =
    typeof body.fromBaselineId === "string" ? body.fromBaselineId.trim() : "";
  if (fromBaselineId) {
    // Baselines are global — not scoped by user, only by the chassis they were published against.
    const baseline = await prisma.baselineSetup.findUnique({
      where: { id: fromBaselineId },
      select: { data: true, setupSheetModelId: true },
    });
    if (!baseline) return NextResponse.json({ error: "Baseline not found" }, { status: 404 });
    if (baseline.setupSheetModelId !== car.setupSheetModelId) {
      return NextResponse.json(
        { error: "That baseline belongs to a different chassis type." },
        { status: 400 }
      );
    }
    if (body.data === undefined) sourceData = baseline.data;
  }

  const createArgs = {
    data: {
      userId: userId,
      carId,
      name,
      isLibrary: true,
      data: normalizeSetupSnapshotForStorage(sourceData),
      ...(baseId ? { baseSetupSnapshotId: baseId } : {}),
      ...(fromBaselineId ? { sourceBaselineId: fromBaselineId } : {}),
    },
    select: { id: true, name: true, createdAt: true },
  };

  /**
   * Promoting a parked sequential fill: the draft goes in the same transaction as the create,
   * never as a follow-up request. That flow's whole premise is the app getting backgrounded
   * mid-action, and a save that lands without its cleanup leaves a "Draft in progress" card
   * pointing at a setup that already exists.
   */
  const setup = body.clearFillDraft === true
    ? (
        await prisma.$transaction([
          prisma.setupSnapshot.create(createArgs),
          prisma.setupFillDraft.deleteMany({ where: { userId, carId } }),
        ])
      )[0]
    : await prisma.setupSnapshot.create(createArgs);

  return NextResponse.json(
    { setup: { id: setup.id, name: setup.name, createdAt: setup.createdAt.toISOString() } },
    { status: 201 }
  );
}
