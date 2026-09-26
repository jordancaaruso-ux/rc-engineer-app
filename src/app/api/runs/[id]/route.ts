import { NextResponse } from "next/server";
import { revalidateAfterRunMutation } from "@/lib/revalidateUser";
import { applyRunWindow } from "@/lib/runs/runWindow";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedApiUserId } from "@/lib/currentUser";
import { hasDatabaseUrl } from "@/lib/env";
import { normalizeSetupSnapshotForStorage } from "@/lib/runSetup";
import {
  normalizeRunConditionsInput,
  runConditionsFromRecord,
  NULL_RUN_CONDITIONS_COLUMNS,
  type RunConditionsRecord,
} from "@/lib/weather/runConditionsRecord";
import {
  buildSetupCorrectionWrites,
  clearEngineerReadsReferencing,
  runSelectForSetupCorrection,
} from "@/lib/runs/applySetupCorrection";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { applyTireRunNumberCascade } from "@/lib/tires/applyTireRunNumberCascade";
import { applyRunCarMove } from "@/lib/runs/applyRunCarMove";
import { normalizeTirePrep, tirePrepHasContent, derivedWarmerTimingMinutes } from "@/lib/runs/tirePrep";
import { normalizeTireFitment } from "@/lib/tires/tireFitment";
import { getFiveMinuteStintStartingAt, primaryLapRowsFromRun } from "@/lib/lapAnalysis";
import { normalizeLapTimes } from "@/lib/runLaps";
import { LAP_SESSION_VERSION } from "@/lib/lapSession/types";
import {
  parseRunAtIso,
  readingIsForAnotherTime,
  stampEditedRunTime,
  withLoggingOrder,
  withTypedTrackTemp,
} from "@/lib/runs/runTime";
import { backfillRunConditionsFromTrack } from "@/lib/weather/backfillRunConditionsFromTrack";
import { trackHasMarkedLocation } from "@/lib/location/coordinates";

/**
 * Delete a run owned by the current user.
 *
 * Related rows:
 *  - `RunImportedLapSet` (+ laps) cascade automatically.
 *  - `ActionItem.sourceRunId` is set null (schema SetNull).
 *  - `ImportedLapTimeSession.linkedRunId` / `Run.importedLapTimeSessionId`
 *    are set null (schema SetNull).
 *  - `SetupSnapshot` is intentionally NOT deleted — other runs (and the
 *    setup history) may still reference it.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not set" },
      { status: 500 }
    );
  }

  const userId = await getAuthenticatedApiUserId();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const existing = await prisma.run.findFirst({
    where: { id, userId: userId },
    select: { id: true, eventId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  await prisma.run.delete({ where: { id: existing.id } });

  // One fewer run in the plan window: the newest hidden run, if there is one, comes back
  // (Starter keeps fifteen; docs/STARTER_TIER_PLAN.md).
  await applyRunWindow(userId);

  revalidateAfterRunMutation(userId);

  return NextResponse.json({ ok: true });
}

/**
 * Correct one detail of a logged run, in place, from the run page.
 *
 * ============================== WHY THIS IS NOT THE WIZARD ==============================
 *
 * `PUT /api/runs` is the whole-run write: it takes everything the six-step log-run
 * wizard collects, re-derives the tire stint, re-resolves the setup baseline and
 * mints a snapshot. That is the right shape for "I am logging a run" and the wrong
 * shape for "the track temp says 43 and it was 34" — a sparse fix should not have to
 * round-trip every other field to change one number.
 *
 * ============================== WHAT IT WRITES ==============================
 *
 * Everything on the session view the driver typed themselves: the session label, the
 * event, the car, the tire set and its run number, tire prep, the additive, notes, the
 * car rating and the handling assessment. And when the run was on track (`runAtIso`), for a
 * run typed in after the fact; a run whose laps came off a timing sheet keeps the sheet's
 * time (`lib/runs/runTime.ts`). Conditions are here too, but only as a
 * leftover of the earlier design — the run page no longer offers them (founder call
 * 2026-08-20: conditions are fetched, so typing over them makes the record lie about
 * where it came from). The parser stays because nothing else writes those columns
 * sparsely and removing it would strand the API, not because a surface uses it.
 *
 * ============================== WHAT IS DELIBERATELY NOT HERE ==============================
 *
 *  - **Setup values.** Copy-on-write, and they can travel to later runs, so they have
 *    their own door: `POST /api/runs/[id]/setup-correction`.
 *  - **Lap times.** Never retyped, imported or otherwise. Correcting laps means
 *    changing which timing session feeds the run — `PUT /api/runs/[id]/lap-import`.
 *  - **The track.** Fixed once logged. The one way the track can move is a run that
 *    had none taking its new event's, below.
 *
 * The tire set and its run number USED to be refused here, because the run-number
 * cascade lives in `POST/PUT /api/runs` and two copies would drift. That home moved to
 * `lib/tires/applyTireRunNumberCascade`, which both routes now call, so the reason
 * expired rather than the rule being broken.
 */

/** The conditions a driver can retype. Wind direction, cloud cover and the observation stamp are readings, not opinions — they stay with whatever recorded them. */
const EDITABLE_CONDITION_KEYS = ["trackTempC", "airTempC", "humidityPct", "windKph"] as const;
type EditableConditionKey = (typeof EDITABLE_CONDITION_KEYS)[number];

function readConditionPatch(body: Record<string, unknown>): Partial<Record<EditableConditionKey, number | null>> | null {
  const raw = body.conditions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const patch: Partial<Record<EditableConditionKey, number | null>> = {};
  let touched = false;
  for (const key of EDITABLE_CONDITION_KEYS) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v === null || v === "") {
      patch[key] = null;
      touched = true;
      continue;
    }
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isFinite(n)) continue;
    patch[key] = n;
    touched = true;
  }
  return touched ? patch : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
  const userId = await getAuthenticatedApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const run = await prisma.run.findFirst({
    where: { id, userId },
    select: {
      ...runSelectForSetupCorrection,
      additiveTypeId: true,
      // The 5-minute window choice lives inside lapSession; validating a new
      // start lap needs the laps themselves.
      lapTimes: true,
      lapSession: true,
      // The identity columns a correction may touch, plus what the tire cascade
      // measures its shift against.
      trackId: true,
      sessionLabel: true,
      tireTypeId: true,
      tireStintId: true,
      tireRunNumber: true,
      frontTireTypeId: true,
      frontTireStintId: true,
      frontTireRunNumber: true,
      unconfirmedAt: true,
      // When it was on track: what a new `runAtIso` is measured against, and whether a timing
      // sheet owns the time.
      createdAt: true,
      sessionCompletedAt: true,
      loggingCompletedAt: true,
      importedLapTimeSessionId: true,
      localTimeZone: true,
      conditionsAirTempC: true,
      conditionsTrackTempC: true,
      conditionsCloudCoverPct: true,
      conditionsWeatherCode: true,
      conditionsHumidityPct: true,
      conditionsWindKph: true,
      conditionsWindDirDeg: true,
      conditionsSource: true,
      conditionsLatitude: true,
      conditionsLongitude: true,
      conditionsObservedAt: true,
    },
  });
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const data: Record<string, unknown> = {};

  /*
   * Conditions are merged, not replaced: the driver is retyping one reading, and
   * the rest of the record (wind direction, the pin the forecast was fetched for)
   * is still true. Re-normalising the merged whole is what stamps `manual` on the
   * source, which is the honest label once a human has touched it.
   */
  const conditionPatch = readConditionPatch(body);
  if (conditionPatch) {
    const merged = { ...runConditionsFromRecord(run), ...conditionPatch, source: "manual" };
    /*
     * A null back means "clear every column", not "no change". Clearing the only
     * reading a run had leaves the merged record empty, and `normalizeRunConditionsInput`
     * answers null for an empty reading — so without the fallback, emptying the last
     * field 400s with "nothing to change" and the value stays on screen. Same
     * `?? NULL_RUN_CONDITIONS_COLUMNS` the whole-run write uses.
     *
     * That fallback also drops the pin, the observation stamp and the source, and
     * that is intended: `isConditionsEmpty` counts only the six measurements, so
     * reaching here means none are left, and a latitude describing a reading nobody
     * has any more is provenance for nothing. Re-fetching does not need it either —
     * `backfillRunConditionsFromTrack` reads the TRACK's pin, not the run's.
     */
    const columns: RunConditionsRecord =
      normalizeRunConditionsInput(merged) ?? NULL_RUN_CONDITIONS_COLUMNS;
    Object.assign(data, columns);
  }

  /*
   * ============================== WHEN THE RUN WAS ON TRACK ==============================
   *
   * `runAtIso` is the racer's pick of when the car ran, for a run typed in after the fact: last
   * night's practice logged this morning sat on today for good, and missed that night's meeting
   * (test drive 2026-09-26). It moves the day the run files under (`sortAt`) and the time it shows
   * (`sessionCompletedAt`) together, from one instant. A run whose laps came off a timing sheet
   * keeps the sheet's time, and a pick matching what the run already says moves nothing. The rules
   * are `lib/runs/runTime.ts`, shared with the whole-run write.
   *
   * The weather moves with it: a reading fetched for the old hour is fetched again for the new one
   * from the track's pin. With no pin, or no answer, the fetched part is dropped rather than left
   * describing another hour. A probe track temp the racer typed stays.
   */
  let movedTo: Date | null = null;
  if ("runAtIso" in body) {
    const now = new Date();
    const parsed = parseRunAtIso(body.runAtIso, now);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.at) {
      const edited = stampEditedRunTime({
        stored: run,
        importedAt: run.importedLapTimeSessionId != null ? run.sessionCompletedAt : null,
        importedAtIsOnTrack: true,
        runAt: withLoggingOrder(parsed.at, now, run.localTimeZone),
      });
      movedTo = edited.moveTo;
    }
    if (movedTo) {
      data.sortAt = movedTo;
      data.sessionCompletedAt = movedTo;
      if (!conditionPatch && readingIsForAnotherTime(run, movedTo)) {
        const track = run.trackId
          ? await prisma.track.findUnique({
              where: { id: run.trackId },
              select: { latitude: true, longitude: true },
            })
          : null;
        const fetched =
          track && trackHasMarkedLocation(track)
            ? await backfillRunConditionsFromTrack({
                latitude: track.latitude!,
                longitude: track.longitude!,
                atIso: movedTo.toISOString(),
              })
            : null;
        Object.assign(
          data,
          withTypedTrackTemp(fetched ?? NULL_RUN_CONDITIONS_COLUMNS, run.conditionsTrackTempC)
        );
      }
    }
  }

  /*
   * The additive is a catalog row, so it is chosen rather than typed. `null` clears
   * it — a run logged with an additive the driver did not actually use.
   */
  // `undefined` = the body did not mention the additive. `""` = clear it.
  let additiveDisplayName: string | undefined;
  if ("additiveTypeId" in body) {
    const raw = body.additiveTypeId;
    if (raw === null || raw === "") {
      data.additiveTypeId = null;
      additiveDisplayName = "";
    } else if (typeof raw === "string") {
      const additive = await prisma.additiveType.findUnique({
        where: { id: raw },
        select: { id: true, displayName: true },
      });
      if (!additive) {
        return NextResponse.json({ error: "Additive type not found" }, { status: 400 });
      }
      data.additiveTypeId = additive.id;
      additiveDisplayName = additive.displayName;
    }
  }

  /*
   * ============================== THE SESSION LABEL AND THE EVENT ARE NOT HERE ==============================
   *
   * Both were correctable through this route until 2026-08-21, and the founder took them back.
   * They are the run's IDENTITY, not the driver's opinion of it: an event re-homes the session
   * into a different meeting, carrying its track and its place in the day with it, and the
   * session label is stamped by the timing sheet the run came off.
   *
   * They are removed rather than merely hidden on the panel, because this route is the only
   * thing that ever stopped a hand-rolled PATCH from moving a run to another meeting. The
   * event branch used to carry a same-track check for exactly that reason; with no branch at
   * all there is nothing left to guard, which is the stronger version of the same rule.
   *
   * `POST /api/runs` still sets both at logging time. This is about CORRECTING a logged run.
   */

  /*
   * Notes and the two feel controls. All three are the driver's own words about
   * their own run, so there is nothing to validate beyond shape and range — and
   * nothing downstream re-derives from them except the Engineer's read, cleared
   * below with everything else.
   */
  if ("notes" in body) {
    data.notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  }
  if ("carRating" in body) {
    const raw = body.carRating;
    if (raw === null) {
      data.carRating = null;
    } else {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n) || n < 1 || n > 10) {
        return NextResponse.json({ error: "Rating must be 1–10" }, { status: 400 });
      }
      data.carRating = Math.round(n);
    }
  }
  /*
   * The 5-minute window's one handle: which lap it opens on (founder ruling,
   * 2026-09-01 — per run, auto = best window, with the option to move it).
   * Stored INSIDE the lapSession blob rather than a new column: it is a
   * judgement about the laps, same class as the per-lap exclusions that live
   * there, and additive on the version-1 shape so every existing reader is
   * unaffected. `null` = back to auto. A start the laps can't fund is refused
   * here, but readers still re-validate — laps can be re-imported later.
   */
  if ("fiveMinStartLap" in body) {
    const raw = body.fiveMinStartLap;
    const existingSession =
      run.lapSession && typeof run.lapSession === "object" && !Array.isArray(run.lapSession)
        ? (run.lapSession as Record<string, unknown>)
        : null;
    if (raw === null) {
      if (existingSession && existingSession.fiveMinStartLap != null) {
        data.lapSession = { ...existingSession, fiveMinStartLap: null } as Prisma.InputJsonValue;
      }
      // No blob, or nothing stored → already auto; nothing to write.
    } else {
      const n = typeof raw === "number" ? raw : Number.NaN;
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json({ error: "Start lap must be a lap number" }, { status: 400 });
      }
      const rows = primaryLapRowsFromRun({ lapTimes: run.lapTimes, lapSession: run.lapSession });
      if (getFiveMinuteStintStartingAt(rows, n) == null) {
        return NextResponse.json(
          { error: "Not five minutes of laps from there" },
          { status: 400 }
        );
      }
      /*
       * Older runs logged before structured ingestion have laps only in
       * `lapTimes` — give them the minimal honest blob (primary laps mirrored,
       * per the schema's invariant) so the choice has somewhere to live.
       */
      const base =
        existingSession ??
        ({
          version: LAP_SESSION_VERSION,
          source: { kind: "manual", detail: "run laps" },
          entries: [{ role: "primary", laps: normalizeLapTimes(run.lapTimes) }],
        } as Record<string, unknown>);
      data.lapSession = { ...base, fiveMinStartLap: n } as Prisma.InputJsonValue;
    }
  }

  if ("handlingAssessmentJson" in body) {
    const raw = body.handlingAssessmentJson;
    data.handlingAssessmentJson =
      raw === null || raw === undefined
        ? Prisma.JsonNull
        : (raw as Prisma.InputJsonValue);
  }

  /* The application sequence — steps in, steps out. Normalised the same way the
     whole-run write normalises it, so a corrected run and a logged one are one shape. */
  if ("tirePrep" in body) {
    const steps = normalizeTirePrep(body.tirePrep);
    data.tirePrep = tirePrepHasContent(steps) ? (steps as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
    data.warmerTimingMinutes = derivedWarmerTimingMinutes(steps);
  }

  /*
   * The tire set and its run number.
   *
   * These used to be refused here on the grounds that `tireStintId` chains runs into
   * one life of rubber and the run-number cascade has one home. Both are still true;
   * what changed is that the home moved out to `applyTireRunNumberCascade`, which the
   * whole-run write now calls as well — so this is the same logic, not a second copy
   * (founder call 2026-08-20: "tire sets / runs should be editable").
   *
   * Changing the COMPOUND forks onto fresh rubber: a new stint id, and no cascade,
   * because the set this run just left has no opinion about a run that is no longer
   * on it. Keeping the compound and moving the number shifts every later run on the
   * same stint, which is the whole point.
   */
  let tireCascade: Awaited<ReturnType<typeof applyTireRunNumberCascade>> = null;
  const wantsTireChange = "tireTypeId" in body || "tireRunNumber" in body || "tireAgeKnown" in body;
  let nextTireStintId = run.tireStintId;
  let nextTireRunNumber = run.tireRunNumber;
  if (wantsTireChange) {
    if ("tireTypeId" in body) {
      const raw = body.tireTypeId;
      if (raw === null || raw === "") {
        data.tireTypeId = null;
        data.tireStintId = null;
        nextTireStintId = null;
      } else if (typeof raw === "string") {
        const tire = await prisma.tireType.findUnique({ where: { id: raw }, select: { id: true } });
        if (!tire) return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
        data.tireTypeId = tire.id;
        if (tire.id !== run.tireTypeId) {
          nextTireStintId = randomUUID();
          data.tireStintId = nextTireStintId;
        }
      }
    }
    if ("tireRunNumber" in body) {
      const n =
        typeof body.tireRunNumber === "number"
          ? body.tireRunNumber
          : Number(String(body.tireRunNumber ?? "").trim());
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: "Run number must be 1 or more" }, { status: 400 });
      }
      nextTireRunNumber = Math.floor(n);
      data.tireRunNumber = nextTireRunNumber;
    }
    if ("tireAgeKnown" in body) {
      data.tireAgeKnown = body.tireAgeKnown === false ? false : true;
    }
  }

  /*
   * The FRONT tire of a front/rear car — the block above, run over the front's own columns
   * (2026-09-19). Its own stint and its own count, so a front correction moves the front's later
   * runs and never the rear's. Clearing the front tire clears everything that described it.
   */
  const wantsFrontTireChange =
    "frontTireTypeId" in body || "frontTireRunNumber" in body || "frontTireAgeKnown" in body;
  let nextFrontTireStintId = run.frontTireStintId;
  let nextFrontTireRunNumber = run.frontTireRunNumber;
  if (wantsFrontTireChange) {
    if ("frontTireTypeId" in body) {
      const raw = body.frontTireTypeId;
      if (raw === null || raw === "") {
        data.frontTireTypeId = null;
        data.frontTireStintId = null;
        data.frontTireRunNumber = null;
        data.frontTireAgeKnown = null;
        nextFrontTireStintId = null;
        nextFrontTireRunNumber = null;
      } else if (typeof raw === "string") {
        const tire = await prisma.tireType.findUnique({ where: { id: raw }, select: { id: true } });
        if (!tire) return NextResponse.json({ error: "Tire type not found" }, { status: 400 });
        data.frontTireTypeId = tire.id;
        if (tire.id !== run.frontTireTypeId) {
          nextFrontTireStintId = randomUUID();
          data.frontTireStintId = nextFrontTireStintId;
          // A front that was never there has no count to keep; it starts as a fresh set unless
          // the same request says otherwise just below.
          if (run.frontTireRunNumber == null) {
            nextFrontTireRunNumber = 1;
            data.frontTireRunNumber = 1;
            data.frontTireAgeKnown = true;
          }
        }
      }
    }
    const hasFront = ("frontTireTypeId" in data ? data.frontTireTypeId : run.frontTireTypeId) != null;
    if ("frontTireRunNumber" in body && hasFront) {
      const n =
        typeof body.frontTireRunNumber === "number"
          ? body.frontTireRunNumber
          : Number(String(body.frontTireRunNumber ?? "").trim());
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json({ error: "Run number must be 1 or more" }, { status: 400 });
      }
      nextFrontTireRunNumber = Math.floor(n);
      data.frontTireRunNumber = nextFrontTireRunNumber;
    }
    if ("frontTireAgeKnown" in body && hasFront) {
      data.frontTireAgeKnown = body.frontTireAgeKnown === false ? false : true;
    }
  }

  /* What each end is glued to — insert, wheel, modifications. Normalised like the whole-run
     write; SQL NULL when emptied, because the "own list" scan filters on the column. */
  if ("tireFitment" in body) {
    data.tireFitment =
      (normalizeTireFitment(body.tireFitment) as Prisma.InputJsonValue | null) ?? Prisma.DbNull;
  }

  /* The car. Its own write, because the setup snapshot has to travel with it. */
  const wantsCarMove =
    typeof body.carId === "string" && body.carId.trim() && body.carId.trim() !== run.carId;

  /*
   * ============================== CONFIRMING A RUN THE APP FILED ==============================
   *
   * A run created by "Add N other runs from today" wears `unconfirmedAt` until the driver
   * vouches for it. Corrections on this route never clear it on their own — fixing one tyre
   * count is not a statement that the rest of the carried record is right — so confirming is
   * its own explicit key. It comes from the Confirm control on the run's own card (and from
   * "Confirm" in place of "Done" while that card is in edit mode); the wizard's whole-run
   * save clears the same column in `PUT /api/runs`.
   */
  if (body.confirm === true && run.unconfirmedAt != null) {
    data.unconfirmedAt = null;
  }

  if (
    Object.keys(data).length === 0 &&
    additiveDisplayName === undefined &&
    !wantsCarMove &&
    // "Back to auto" with nothing stored writes nothing — a valid state, not an error.
    !("fiveMinStartLap" in body) &&
    // Confirming an already-confirmed run is a no-op, not a mistake.
    body.confirm !== true &&
    // So is a time the run already shows, or one its timing sheet owns.
    !("runAtIso" in body)
  ) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }

  if (Object.keys(data).length > 0) {
    await prisma.run.update({ where: { id: run.id }, data });
  }
  // A new time can carry the run across the plan window's edge (Starter keeps fifteen by
  // `sortAt`; docs/STARTER_TIER_PLAN.md), same as a drag in Sessions.
  if (movedTo) {
    await applyRunWindow(userId);
  }

  if (wantsTireChange) {
    tireCascade = await applyTireRunNumberCascade({
      userId,
      runId: run.id,
      tireStintId: nextTireStintId,
      previousTireStintId: run.tireStintId,
      previousTireRunNumber: run.tireRunNumber,
      nextTireRunNumber,
      sortAt: run.sortAt,
    });
  }
  if (wantsFrontTireChange && run.frontTireRunNumber != null && nextFrontTireRunNumber != null) {
    const frontCascade = await applyTireRunNumberCascade({
      userId,
      runId: run.id,
      end: "front",
      tireStintId: nextFrontTireStintId,
      previousTireStintId: run.frontTireStintId,
      previousTireRunNumber: run.frontTireRunNumber,
      nextTireRunNumber: nextFrontTireRunNumber,
      sortAt: run.sortAt,
    });
    tireCascade = tireCascade ?? frontCascade;
  }


  /*
   * The additive is also stamped INTO the setup snapshot, because the filled sheet
   * prints it — see `applyRunContextToSetupSnapshot`. Only when the sheet actually
   * carries the field: a chassis whose sheet has no additive box should not grow
   * one because a run was corrected. Copy-on-write, like every other snapshot edit.
   */
  if (additiveDisplayName !== undefined) {
    const snapshotData = normalizeSetupSnapshotForStorage(run.setupSnapshot?.data ?? null);
    if ("additive" in snapshotData) {
      const built = await buildSetupCorrectionWrites({
        userId,
        run,
        key: "additive",
        value: additiveDisplayName,
      });
      if (built) {
        await prisma.$transaction(built.writes);
      }
    }
  }

  /*
   * The car move runs LAST, after the additive stamp above.
   *
   * Both of them mint a snapshot and repoint the run at it, and they read the run's
   * snapshot as it was loaded at the top of this request. Running the move first
   * meant the additive stamp copied the OLD snapshot — the one still on the old car —
   * and repointed the run back at it, quietly undoing the move's whole reason for
   * existing. Only a request that changed both would hit it, which is exactly the
   * kind of bug that survives a manual test.
   */
  if (wantsCarMove) {
    try {
      const moved = await prisma.run.findFirst({
        where: { id: run.id, userId },
        select: {
          setupSnapshot: {
            select: { id: true, data: true, baseSetupSnapshotId: true, sheetBlankId: true },
          },
        },
      });
      await applyRunCarMove({
        userId,
        runId: run.id,
        toCarId: (body.carId as string).trim(),
        setupSnapshot: moved?.setupSnapshot ?? null,
      });
    } catch {
      return NextResponse.json({ error: "Car not found" }, { status: 400 });
    }
  }

  /*
   * Every Engineer read on this run was computed against details that have now moved,
   * so it is no longer an answer to it. `fieldFingerprint` is built only from lap
   * material, so without this a changed car or session leaves a stale summary sitting
   * under new facts — the same staleness the setup correction had to fix.
   */
  /*
   * …except a bare window move: the Engineer never quotes the 5-minute stint
   * (it reads auto-best metrics), so sliding the window changes nothing the
   * read was computed from — wiping it would cost a paid re-read for a glance.
   */
  const onlyWindowMove = Object.keys(body).length === 1 && "fiveMinStartLap" in body;
  // A time that moved nothing changed nothing the read was computed from either.
  const onlyUnmovedTime = Object.keys(body).length === 1 && "runAtIso" in body && movedTo == null;
  if (!onlyWindowMove && !onlyUnmovedTime) {
    await clearEngineerReadsReferencing(userId, [run.id]);
  }

  revalidateAfterRunMutation(userId);

  return NextResponse.json({ ok: true, tireRunNumberCascade: tireCascade });
}
