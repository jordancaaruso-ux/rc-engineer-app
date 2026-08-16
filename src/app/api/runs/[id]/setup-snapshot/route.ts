import { NextResponse } from "next/server";
import { buildTireSelectionValue } from "@/lib/tires/tireSelectionValue";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { viewerMayAccessRun } from "@/lib/teams/teamRunAccess";
import { formatRunSessionDisplay } from "@/lib/runSession";
import {
  normalizeSetupSnapshotForStorage,
  type SetupSnapshotData,
} from "@/lib/runSetup";
import { computeSetupDeltaForAudit } from "@/lib/setup/resolveSetupSnapshot";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { loadTeamMemberDisplays } from "@/lib/teams/teamMemberDisplay";
import { savedRunSetupName, teammateSetupCopyName } from "@/lib/setup/setupSaveName";
import { carsMatchingChassis } from "@/lib/setup/setupCopyTargets";
import { isA800RRCar, labelForSetupSheetTemplate } from "@/lib/setupSheetTemplateId";
import type { SetupSaveContext } from "@/lib/setup/setupSaveContext";
import { lastRunAtMsByCarId, orderCarsByRecentUse } from "@/lib/cars/orderCarsByRecentUse";
import { getSetupSheetTemplateAndKeyForCar } from "@/lib/setupSheetModels/getTemplateForCar";
import { chassisFillsAsSheet } from "@/lib/setupSheetModels/sheetPlan";
import { pickSheetBlankForData } from "@/lib/setupSheetModels/sheetBlankResolve";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

type Params = { params: Promise<{ id: string }> };

const runSelectForPdfReview = {
  id: true,
  userId: true,
  shareWithTeam: true,
  createdAt: true,
  sessionType: true,
  meetingSessionType: true,
  meetingSessionCode: true,
  sessionLabel: true,
  carId: true,
  setupSnapshotId: true,
  car: {
    select: {
      id: true,
      name: true,
      setupSheetTemplate: true,
      setupSheetModelId: true,
      // The chassis's own name ("Xray X4"), not the owner's nickname for the car. Only used to
      // name the chassis back to a viewer who doesn't have one.
      setupSheetModel: { select: { name: true } },
    },
  },
  trackNameSnapshot: true,
  track: { select: { id: true, name: true } },
  event: { select: { name: true, track: { select: { name: true } } } },
  // `isLibrary` + `name` are read for the Save control in the Setup panel, never returned raw:
  // on a teammate's run they are THEIR bookmark and THEIR name, which say nothing about whether
  // the viewer has kept a copy. `buildSaveContext` below decides what the viewer is told.
  setupSnapshot: {
    select: { id: true, data: true, baseSetupSnapshotId: true, isLibrary: true, name: true },
  },
} as const;

type RunForSave = {
  userId: string;
  carId: string | null;
  car: {
    id: string;
    name: string;
    setupSheetTemplate: string | null;
    setupSheetModelId: string | null;
    setupSheetModel: { name: string } | null;
  } | null;
  track: { name: string } | null;
  trackNameSnapshot: string | null;
  event: { name: string; track: { name: string } | null } | null;
  setupSnapshot: { id: string; isLibrary: boolean; name: string | null } | null;
};

/**
 * Saving a setup from inside a session — the bookmark the car page has always had, on the surface
 * where the driver is actually looking at the setup (founder call, 2026-08-15).
 *
 * Your own run MARKS: `isLibrary` flips on the snapshot the run already points at, so the car holds
 * one setup in two places rather than two copies of it. A teammate's run COPIES: their snapshot is
 * theirs, and marking it would put a row in their library, not yours.
 *
 * `saved` is deliberately false on every teammate run, even when a copy is already sitting in your
 * list. There is nothing on the copy that links it back — no provenance column was added — so the
 * only honest answer to "have I kept this one?" is "I can't tell", and a hollow bookmark that saves
 * a second copy is a better failure than a filled one that lies.
 */
function buildSaveContext(
  run: RunForSave,
  viewerId: string,
  sessionDisplay: string,
  driverName: string | null,
  myCars: ReadonlyArray<{ id: string; name: string; setupSheetTemplate: string | null; setupSheetModelId: string | null }>
): SetupSaveContext {
  const snapshot = run.setupSnapshot;
  if (!snapshot) {
    return { action: "none", saved: false, name: "", targetCars: [], chassisLabel: null };
  }

  if (run.userId === viewerId) {
    return {
      action: "mark",
      saved: snapshot.isLibrary,
      // Once named, that name is what the driver will look for; the generated title is only ever
      // the starting point for a setup that has never been saved.
      name: snapshot.name ?? savedRunSetupName({ eventName: run.event?.name, sessionDisplay }),
      targetCars: [],
      chassisLabel: null,
    };
  }

  const trackName = run.track?.name ?? run.event?.track?.name ?? run.trackNameSnapshot ?? null;
  return {
    action: "copy",
    saved: false,
    name: teammateSetupCopyName({ driverName, sessionDisplay, trackName }),
    targetCars: (run.car ? carsMatchingChassis(run.car, myCars) : []).map((car) => ({
      id: car.id,
      name: car.name,
    })),
    chassisLabel:
      run.car?.setupSheetModel?.name ??
      (isA800RRCar(run.car?.setupSheetTemplate)
        ? labelForSetupSheetTemplate(run.car?.setupSheetTemplate)
        : null),
  };
}

type SheetContext = {
  /** Does this chassis draw as a picture of its own sheet, rather than as a field list? */
  sheetMode: boolean;
  setupSheetModelId: string | null;
  /** The EDITION this run's setup keys are written on, when not the primary blank. */
  editionBlankId: string | null;
  /** The field list — still the surface for every chassis the app cannot draw. */
  template: SetupSheetTemplate;
  /** Community-aggregation bucket key; null when the car has no chassis of its own. */
  templateKey: string | null;
};

/**
 * Which surface this run's setup is read on, decided HERE rather than from the car.
 *
 * The same answer used to come from `/api/cars/[carId]/setup-sheet-template`, which scopes its
 * lookup to `where: { id, userId }` — cars are owner-only, by ruling (`ASSET_ACCESS_NORTH_STAR`).
 * Asked about a TEAMMATE's car it therefore 404s, the caller reads no template and no model id off
 * the error body, and the setup silently drops to the legacy field list. That is the whole of the
 * "a teammate's sheet opens as the old form" bug: not a missing sheet, a car the viewer may not read.
 *
 * This route already answers "may this viewer see this run", so the car it carries is one they are
 * allowed to look at. Everything the answer points AT is global anyway — the chassis, its box list
 * (`/sheet-plan`) and its page picture (`/sheet-page`) are all served to any signed-in driver,
 * because a manufacturer's blank sheet is nobody's setup.
 */
async function buildSheetContext(
  userId: string,
  car: { setupSheetModelId: string | null; setupSheetTemplate: string | null } | null,
  snapshotData: unknown
): Promise<SheetContext> {
  const resolved = car ?? { setupSheetModelId: null, setupSheetTemplate: null };
  // A derived chassis is always attached by id, so no link means no sheet — nothing to resolve.
  // Which of the chassis's sheets is decided by the SNAPSHOT's keys: a setup imported through a
  // rebuilt EDITION draws on that edition's paper, not the primary's. See `sheetBlankResolve`.
  const blank = resolved.setupSheetModelId
    ? await pickSheetBlankForData(
        resolved.setupSheetModelId,
        snapshotData && typeof snapshotData === "object" && !Array.isArray(snapshotData)
          ? (snapshotData as Record<string, unknown>)
          : null
      )
    : null;
  const { template, templateKey } = await getSetupSheetTemplateAndKeyForCar(userId, resolved, "setup");
  return {
    sheetMode: chassisFillsAsSheet(blank),
    setupSheetModelId: resolved.setupSheetModelId,
    editionBlankId: blank?.isEdition ? blank.id : null,
    template,
    templateKey,
  };
}

/** Lazy-load setup snapshot + run context for sessions modal / PDF review page. */
export async function GET(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  /*
   * Opt-in, because the setup modal calls this route up to three times for one open — the run being
   * read, the run it is compared against, and the previous run on the car — and only the first of
   * those draws a surface. The other two want the values and nothing else.
   */
  const wantsSheet = new URL(request.url).searchParams.get("sheet") === "1";

  const run = await prisma.run.findFirst({
    where: { id },
    select: runSelectForPdfReview,
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await viewerMayAccessRun(userId, run))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sessionParts = {
    sessionType: run.sessionType,
    meetingSessionType: run.meetingSessionType,
    meetingSessionCode: run.meetingSessionCode,
    sessionLabel: run.sessionLabel,
  };
  const sessionLabel = formatRunSessionDisplay(sessionParts);

  const isOwner = run.userId === userId;

  // Only a teammate's run needs any of these, and only when there is a setup to copy: the driver's
  // name goes into the copy's title, and the car list is what it can land on. Skipping them on your
  // own runs keeps the common case at the one query it has always been.
  const needsCopyTargets = !isOwner && run.setupSnapshot != null;
  const [driverDisplay, myCars, lastRunRows] = needsCopyTargets
    ? await Promise.all([
        loadTeamMemberDisplays([run.userId], userId),
        prisma.car.findMany({
          where: { userId },
          select: {
            id: true,
            name: true,
            createdAt: true,
            setupSheetTemplate: true,
            setupSheetModelId: true,
          },
        }),
        prisma.run.groupBy({
          by: ["carId"],
          where: { userId },
          _max: { createdAt: true },
        }),
      ])
    : [null, [], []];

  const save = buildSaveContext(
    run,
    userId,
    formatRunSessionDisplay(sessionParts, { fallback: "Testing run" }),
    driverDisplay?.get(run.userId)?.name ?? null,
    // Most recently driven first — the same order every other car list in the app uses, so the
    // picker's top entry is the car you are most likely putting this setup on.
    orderCarsByRecentUse(myCars, lastRunAtMsByCarId(lastRunRows), (car) => car.createdAt.getTime())
  );

  const sheet = wantsSheet
    ? await buildSheetContext(userId, run.car, run.setupSnapshot?.data ?? null)
    : null;

  return NextResponse.json({
    runId: run.id,
    isOwner,
    run: {
      id: run.id,
      createdAt: run.createdAt,
      sessionLabel,
      car: run.car,
      track: run.track,
      event: run.event,
    },
    // Explicit, not the row: the snapshot's `isLibrary`/`name` belong to whoever owns the run and
    // are answered for the viewer in `save` instead.
    setupSnapshot: run.setupSnapshot
      ? {
          id: run.setupSnapshot.id,
          data: run.setupSnapshot.data,
          baseSetupSnapshotId: run.setupSnapshot.baseSetupSnapshotId,
        }
      : null,
    save,
    // Null unless asked for — see `wantsSheet`.
    sheet,
  });
}

/** Owner-only: persist edited setup to a new snapshot and invalidate cached PDF. */
export async function PATCH(request: Request, { params }: Params) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const run = await prisma.run.findFirst({
    where: { id, userId: userId },
    select: {
      id: true,
      carId: true,
      tireTypeId: true,
      tireRunNumber: true,
      tireAgeKnown: true,
      tireType: { select: { id: true, displayName: true } },
      setupSnapshotId: true,
      setupSnapshot: {
        select: {
          id: true,
          data: true,
          // The setup this run was logged AGAINST — the previous run's, usually. Carried forward
          // below so a correction doesn't rewrite what this run changed.
          baseSetupSnapshotId: true,
          baseSetupSnapshot: { select: { id: true, data: true } },
        },
      },
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  if (!run.carId) {
    return NextResponse.json({ error: "Run has no car" }, { status: 400 });
  }

  const body = (await request.json()) as { setupData?: unknown };
  if (!body.setupData || typeof body.setupData !== "object" || Array.isArray(body.setupData)) {
    return NextResponse.json({ error: "setupData is required" }, { status: 400 });
  }

  let resolvedData = normalizeSetupSnapshotForStorage(body.setupData as SetupSnapshotData);

  const tireValue =
    run.tireTypeId && run.tireType
      ? buildTireSelectionValue({
          tireTypeId: run.tireTypeId,
          displayName: run.tireType.displayName,
          tireRunNumber: run.tireRunNumber,
          tireAgeKnown: run.tireAgeKnown,
        })
      : undefined;

  resolvedData = normalizeSetupSnapshotForStorage({
    ...resolvedData,
    tires: tireValue || resolvedData.tires,
  });

  /*
   * A correction replaces the run's snapshot, but it must not replace what the run CHANGED.
   *
   * `setupDeltaJson` is the audit of "what moved since the setup this run was logged against", and
   * the car page filters and chips its whole run history on it. Basing the new delta on the
   * snapshot being replaced would rewrite that to "what I just retyped" — fix one camber value and
   * the run's row stops listing the shock oil and spring it actually changed that day. So the
   * ORIGINAL baseline travels with the correction, and the delta is recomputed against it.
   *
   * A run with no baseline at all is the first setup recorded on that car, which the history reads
   * as "a change by definition" from the null. Keep it null, or correcting a typo would demote it.
   */
  const baseline = run.setupSnapshot?.baseSetupSnapshot ?? null;
  const baselineId = run.setupSnapshot?.baseSetupSnapshotId ?? null;
  const setupDeltaJson = baseline
    ? computeSetupDeltaForAudit(normalizeSetupSnapshotForStorage(baseline.data), resolvedData)
    : null;

  const snapshot = await prisma.setupSnapshot.create({
    data: {
      userId: userId,
      carId: run.carId,
      data: resolvedData as object,
      baseSetupSnapshotId: baselineId,
      setupDeltaJson:
        setupDeltaJson && Object.keys(setupDeltaJson).length > 0
          ? (setupDeltaJson as object)
          : undefined,
    },
    select: { id: true, data: true },
  });

  await prisma.run.update({
    where: { id: run.id },
    data: {
      setupSnapshotId: snapshot.id,
      renderedSetupPdfPath: null,
      renderedSetupPdfGeneratedAt: null,
    },
  });

  /*
   * The community pool reads setup values THROUGH runs, so a corrected run changes what everyone
   * else is compared against. Drop the cached reads here; the aggregation tables themselves are
   * rebuilt by `POST /api/setup-aggregations/rebuild`, same as any other run mutation.
   */
  revalidateAfterRunMutation(userId);

  return NextResponse.json({
    ok: true,
    snapshot: { id: snapshot.id, data: snapshot.data },
  });
}
