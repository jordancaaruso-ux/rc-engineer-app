import { NextResponse } from "next/server";
import { buildTireSelectionValue, isTireFieldKey } from "@/lib/tires/tireSelectionValue";
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
import { setupFieldLabel } from "@/lib/setupCompare/changedSincePrevious";
import { planCascadeCandidatesForRun } from "@/lib/runs/planSetupCascadeCandidates";
import { setupKeyIsInlineEditable } from "@/lib/setup/inlineEditableKeys";
import { changedSetupKeys } from "@/lib/setup/setupValuesFingerprint";
import { MAX_CASCADE_QUESTIONS } from "@/lib/runs/setupCorrectionCascade";
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
    select: {
      id: true,
      data: true,
      baseSetupSnapshotId: true,
      isLibrary: true,
      name: true,
      sheetBlankId: true,
    },
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
  snapshotData: unknown,
  snapshotSheetBlankId: string | null
): Promise<SheetContext> {
  const resolved = car ?? { setupSheetModelId: null, setupSheetTemplate: null };
  // A derived chassis is always attached by id, so no link means no sheet — nothing to resolve.
  // Which of the chassis's sheets: the paper this setup was born on (its stamp), else the one
  // whose boxes speak its keys. See `sheetBlankResolve`.
  const blank = resolved.setupSheetModelId
    ? await pickSheetBlankForData(
        resolved.setupSheetModelId,
        snapshotData && typeof snapshotData === "object" && !Array.isArray(snapshotData)
          ? (snapshotData as Record<string, unknown>)
          : null,
        { sheetBlankId: snapshotSheetBlankId }
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
    ? await buildSheetContext(
        userId,
        run.car,
        run.setupSnapshot?.data ?? null,
        run.setupSnapshot?.sheetBlankId ?? null
      )
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
      // The "logged after" axis the cascade walks forward along. See `planCascadeCandidatesForRun`.
      sortAt: true,
      tireTypeId: true,
      tireRunNumber: true,
      tireAgeKnown: true,
      tireType: { select: { id: true, displayName: true } },
      setupSnapshotId: true,
      setupSnapshot: {
        select: {
          id: true,
          data: true,
          // The paper the setup was born on — a replacement is the same setup retyped.
          sheetBlankId: true,
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
      sheetBlankId: run.setupSnapshot?.sheetBlankId ?? null,
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

  /*
   * ============================== CARRYING THE CASCADE QUESTION ==============================
   *
   * "Did your later runs have this wrong too?" used to be asked by the inline text box on
   * the run page, because that box was the only way to correct a setup value. Since
   * 2026-08-20 setup is corrected on the SHEET instead, and this route is what the sheet
   * saves through — so without this, the single most useful thing about the feature would
   * have quietly stopped happening the moment the better door opened.
   *
   * ============================== WHY A FEW KEYS QUALIFY, AND SIX DO NOT ==============================
   *
   * The cascade answers one question: "you typed a number wrong, and the runs around it
   * inherited the mistake." A save that moved a whole page of boxes is not that — it is a
   * driver redoing a setup on paper, and offering to push all of them onto other runs would
   * rewrite deliberate changes wholesale.
   *
   * It was ONE key until 2026-08-21, and the founder found the edge that made that wrong:
   * spotting two stale numbers on the same sheet and fixing both before pressing save is an
   * ordinary thing to do, and it silently bought you nothing. So the cap is
   * `MAX_CASCADE_QUESTIONS`, asked one value at a time, and a save past the cap now SAYS it
   * offered nothing rather than going quiet.
   */
  const before = normalizeSetupSnapshotForStorage(run.setupSnapshot?.data ?? null);
  /*
   * ============================== WHAT COUNTS AS A CHANGED BOX ==============================
   *
   * `changedSetupKeys` and not a hand-rolled `JSON.stringify` comparison, which is what sat
   * here until 2026-08-21 and quietly cost the feature almost everything.
   *
   * The sheet hands every box back as a STRING — `surfaceValuesToStored` writes `value`, and
   * `value` is what came out of a text box. A snapshot holding the number `5` therefore comes
   * back as `"5"`, and `JSON.stringify(5)` is `5` while `JSON.stringify("5")` is `"5"`. On a
   * setup stored with real numbers that marked EVERY numeric box as changed on every save, so
   * the count was never 1 and the cascade never offered itself at all. `"5.0"` vs `"5"` and
   * `true` vs `"1"` failed the same way.
   *
   * `changedSetupKeys` is the comparison the save bar already runs on (see
   * `setupValuesFingerprint`): two setups differ when they would STORE differently, so `5`,
   * `"5"` and `"5.00"` are one ride height. Using it here means the count means what the
   * sentence above says it means.
   *
   * The tire exclusion stays on top, and for its own separate reason: THIS ROUTE rewrites
   * `tires` a few dozen lines up, re-stamping it from the run's tire context on every save.
   * On the first save after that context moved at all, the re-stamp landed as a second
   * changed key and silenced a genuine single-box correction. Only a real save through the
   * sheet showed it — the shape is invisible to a unit test that hands the route a snapshot
   * it just built.
   */
  const changedKeys = changedSetupKeys(before, resolvedData).filter((key) => !isTireFieldKey(key));

  type CorrectionPayload = {
    key: string;
    label: string;
    previousValue: unknown;
    value: unknown;
    candidates: unknown[];
  };

  /*
   * Only keys the cascade can actually carry. Applying it writes a SCALAR onto each ticked
   * run (`buildSetupCorrectionWrites` takes a string), and `./apply` refuses anything else —
   * so a screw pattern, a multi-select or a preset-with-other would be offered here and then
   * rejected at the moment the driver ticked the runs. Those keep their real controls on the
   * sheet, which is where this save just came from anyway.
   */
  const carryable =
    changedKeys.length <= MAX_CASCADE_QUESTIONS
      ? changedKeys.filter((key) => setupKeyIsInlineEditable(key))
      : [];

  // Captured, not read off `run` inside the callbacks: the `!run.carId` guard above narrows
  // the property, and that narrowing does not survive into a closure.
  const cascadeCarId = run.carId;

  const corrections: CorrectionPayload[] = await Promise.all(
    carryable.map(async (key) => ({
      key,
      label: setupFieldLabel(key),
      previousValue: before[key] ?? null,
      value: resolvedData[key] ?? null,
      candidates: await planCascadeCandidatesForRun({
        userId,
        run: { id: run.id, carId: cascadeCarId, sortAt: run.sortAt },
        key,
        previousValue: before[key],
        nextValue: resolvedData[key] == null ? "" : String(resolvedData[key]),
      }),
    }))
  );

  return NextResponse.json({
    ok: true,
    snapshot: { id: snapshot.id, data: snapshot.data },
    /*
     * One question per corrected value, asked in turn. `correction` is kept as the first of
     * them so a client that has not been redeployed still gets the behaviour it expects.
     *
     * `suppressedKeyCount` is how the run page can say "you changed six boxes, so nothing was
     * offered" instead of going silent — the silence is the whole reason this was reported as
     * a lost feature.
     */
    correction: corrections[0] ?? null,
    corrections,
    suppressedKeyCount: changedKeys.length > MAX_CASCADE_QUESTIONS ? changedKeys.length : 0,
  });
}
