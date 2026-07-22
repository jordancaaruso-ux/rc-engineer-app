import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUser } from "@/lib/currentUser";
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
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const carId = new URL(request.url).searchParams.get("carId")?.trim();
  if (!carId) return NextResponse.json({ error: "carId is required" }, { status: 400 });

  const setups = await prisma.setupSnapshot.findMany({
    where: { userId: user.id, carId, isLibrary: true },
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
  const user = await getAuthenticatedApiUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const car = await prisma.car.findFirst({ where: { id: carId, userId: user.id }, select: { id: true } });
  if (!car) return NextResponse.json({ error: "Car not found" }, { status: 404 });

  const baseId = typeof body.baseSetupSnapshotId === "string" ? body.baseSetupSnapshotId.trim() : "";
  if (baseId) {
    const base = await prisma.setupSnapshot.findFirst({
      where: { id: baseId, userId: user.id },
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
      where: { id: fromId, userId: user.id },
      select: { data: true },
    });
    if (!source) return NextResponse.json({ error: "Setup not found" }, { status: 404 });
    sourceData = source.data;
  }

  const setup = await prisma.setupSnapshot.create({
    data: {
      userId: user.id,
      carId,
      name,
      isLibrary: true,
      data: normalizeSetupSnapshotForStorage(sourceData),
      ...(baseId ? { baseSetupSnapshotId: baseId } : {}),
    },
    select: { id: true, name: true, createdAt: true },
  });

  return NextResponse.json(
    { setup: { id: setup.id, name: setup.name, createdAt: setup.createdAt.toISOString() } },
    { status: 201 }
  );
}
