import { NextResponse } from "next/server";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { resolveRunDisplayInstant } from "@/lib/runCompareMeta";
import { chassisFillsAsSheet, parseStoredBoxes } from "@/lib/setupSheetModels/sheetPlan";
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import { sheetChangeRows } from "@/lib/engineer/sheetChanges";
import { readCarSheetNames } from "@/lib/engineer/carSheetNames";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * What a setup-change link in an Engineer answer opens (sheetLinks.ts): two runs of one car, the
 * boxes that moved between them, and where those boxes sit on the car's sheet.
 *
 * `GET /api/runs/<run>/sheet-changes?since=<the run before it>`
 *
 * Owner only. The Engineer is handed the driver's own runs and nobody else's, so a link can only
 * ever point at two of them; a teammate's run is not what this was built to open. Both runs must be
 * the same car — the Engineer's "changed" line never diffs two cars (founder call 2026-09-01).
 *
 * The paper is the one the LATER run's setup was written on (`pickSheetBlankForData`, the same pick
 * the run's own sheet and the changed-box crops make), and the earlier setup is drawn on that
 * paper too: flipping Before and After must move only the values, never the page.
 */

const SELECT = {
  id: true,
  userId: true,
  carId: true,
  createdAt: true,
  sortAt: true,
  sessionCompletedAt: true,
  loggingCompletedAt: true,
  unconfirmedAt: true,
  importedLapTimeSessionId: true,
  localTimeZone: true,
  setupSnapshot: { select: { data: true, sheetBlankId: true } },
} as const;

type RunRow = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function loadRun(id: string, userId: string) {
  return prisma.run.findFirst({ where: { id, userId }, select: SELECT });
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** HH:mm in the zone the run was logged in — the clock the Engineer's answer used. */
function clockOf(run: RunRow, zone: string | null): string | null {
  if (!zone) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone }).format(
      resolveRunDisplayInstant(run)
    );
  } catch {
    return null;
  }
}

/** "Sat 23 May" in that zone. */
function dayOf(run: RunRow, zone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: zone ?? "UTC" }).format(
      resolveRunDisplayInstant(run)
    );
  } catch {
    return resolveRunDisplayInstant(run).toISOString().slice(0, 10);
  }
}

export async function GET(request: Request, ctx: RouteCtx): Promise<NextResponse> {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "DATABASE_URL is not set" }, { status: 500 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const sinceId = new URL(request.url).searchParams.get("since")?.trim() ?? "";
  if (!sinceId) return NextResponse.json({ error: "since is required" }, { status: 400 });

  const [after, before] = await Promise.all([loadRun(id, userId), loadRun(sinceId, userId)]);
  if (!after || !before || !after.carId || after.carId !== before.carId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const car = await prisma.car.findFirst({
    where: { id: after.carId, userId },
    select: { id: true, setupSheetModelId: true, sheetBoxNamesJson: true },
  });
  if (!car) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const afterData = asRecord(after.setupSnapshot?.data);
  const beforeData = asRecord(before.setupSnapshot?.data);
  const blank = car.setupSheetModelId
    ? await pickSheetBlankForData(car.setupSheetModelId, afterData, {
        sheetBlankId: after.setupSnapshot?.sheetBlankId,
      })
    : null;
  const sheetMode = chassisFillsAsSheet(blank) && Boolean(car.setupSheetModelId);

  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }).catch(() => null);
  const zoneOf = (r: RunRow) => r.localTimeZone ?? owner?.timeZone ?? null;
  const afterDay = dayOf(after, zoneOf(after));
  const beforeDay = dayOf(before, zoneOf(before));

  const changes = sheetChangeRows({
    before: beforeData,
    after: afterData,
    boxes: sheetMode ? parseStoredBoxes(blank?.boxesJson) : [],
    savedNames: readCarSheetNames(car.sheetBoxNamesJson),
  });

  return NextResponse.json({
    sheetMode,
    setupSheetModelId: sheetMode ? car.setupSheetModelId : null,
    // The page pictures come from the same paper the boxes do. Null = the primary blank.
    editionBlankId: sheetMode && blank?.isEdition ? blank.id : null,
    carId: car.id,
    sameDay: afterDay === beforeDay,
    after: { runId: after.id, clock: clockOf(after, zoneOf(after)), day: afterDay, values: afterData },
    before: { runId: before.id, clock: clockOf(before, zoneOf(before)), day: beforeDay, values: beforeData },
    changes,
  });
}
