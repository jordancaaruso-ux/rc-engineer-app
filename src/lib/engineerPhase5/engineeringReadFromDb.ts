import "server-only";

import { prisma } from "@/lib/prisma";
import { pickEngineerReferenceRunId } from "@/lib/engineerPhase5/pickEngineerReferenceRun";
import {
  buildEngineeringReadV1,
  type EngineeringReadRunInput,
  type EngineeringReadV1,
} from "@/lib/engineerPhase5/engineeringRead";

export type EngineeringReadDbRunRow = {
  id: string;
  sortAt: Date;
  createdAt: Date;
  sessionCompletedAt: Date | null;
  trackId: string | null;
  eventId: string | null;
  tireSetId: string | null;
  tireRunNumber: number;
  carRating: number | null;
  handlingAssessmentJson: unknown;
  notes: string | null;
  driverNotes: string | null;
  handlingProblems: string | null;
  lapTimes: unknown;
  lapSession: unknown;
  tireSet: {
    id: string;
    label: string;
    setNumber: number;
    tireType: { displayName: string; modelCode: string } | null;
  } | null;
  setupSnapshot: { data: unknown } | null;
};

function tireLabel(row: EngineeringReadDbRunRow): string | null {
  if (!row.tireSet) return null;
  const name = row.tireSet.tireType?.displayName ?? row.tireSet.label;
  const seg = row.tireSet.setNumber != null ? ` #${row.tireSet.setNumber}` : "";
  return `${name}${seg}`;
}

function rowToInput(row: EngineeringReadDbRunRow): EngineeringReadRunInput {
  return {
    id: row.id,
    sortAtIso: row.sortAt.toISOString(),
    trackId: row.trackId,
    eventId: row.eventId,
    tireSetId: row.tireSetId,
    tireLabel: tireLabel(row),
    tireCompoundLabel: row.tireSet?.tireType?.displayName ?? row.tireSet?.label ?? null,
    tireRunNumber: row.tireRunNumber ?? 1,
    carRating: row.carRating ?? null,
    handlingAssessmentJson: row.handlingAssessmentJson,
    notes: row.notes,
    driverNotes: row.driverNotes,
    handlingProblems: row.handlingProblems,
    lapTimes: row.lapTimes,
    lapSession: row.lapSession,
    setupSnapshotData: row.setupSnapshot?.data ?? null,
  };
}

const engineeringReadRunSelect = {
  id: true,
  sortAt: true,
  createdAt: true,
  sessionCompletedAt: true,
  trackId: true,
  eventId: true,
  tireSetId: true,
  tireRunNumber: true,
  carRating: true,
  handlingAssessmentJson: true,
  notes: true,
  driverNotes: true,
  handlingProblems: true,
  lapTimes: true,
  lapSession: true,
  tireSet: {
    select: {
      id: true,
      label: true,
      setNumber: true,
      tireType: { select: { displayName: true, modelCode: true } },
    },
  },
  setupSnapshot: { select: { data: true } },
} as const;

export async function buildEngineeringReadForRun(params: {
  userId: string;
  anchorRunId: string;
  /** Optional explicit reference run id (compare in Engineer chat); falls back to prior same-car run. */
  referenceRunId?: string | null;
}): Promise<EngineeringReadV1 | null> {
  const anchor = await prisma.run.findFirst({
    where: { id: params.anchorRunId, userId: params.userId },
    select: { ...engineeringReadRunSelect, carId: true },
  });
  if (!anchor) return null;
  if (!anchor.carId) {
    return buildEngineeringReadV1({
      anchor: rowToInput(anchor as unknown as EngineeringReadDbRunRow),
      reference: null,
    });
  }
  return buildEngineeringReadForCarRun({
    userId: params.userId,
    carId: anchor.carId,
    anchorRunId: anchor.id,
    referenceRunId: params.referenceRunId,
  });
}

/**
 * Engineering read where the reference run is constrained to the same car. Preferred
 * call for surfaces that already know the carId; falls back to the Engineer pairwise
 * reference picker (same track / tyre context when possible).
 */
export async function buildEngineeringReadForCarRun(params: {
  userId: string;
  carId: string;
  anchorRunId: string;
  referenceRunId?: string | null;
}): Promise<EngineeringReadV1 | null> {
  const anchor = (await prisma.run.findFirst({
    where: { id: params.anchorRunId, userId: params.userId, carId: params.carId },
    select: engineeringReadRunSelect,
  })) as EngineeringReadDbRunRow | null;
  if (!anchor) return null;

  let referenceRow: EngineeringReadDbRunRow | null = null;
  if (params.referenceRunId) {
    referenceRow = (await prisma.run.findFirst({
      where: { id: params.referenceRunId, userId: params.userId },
      select: engineeringReadRunSelect,
    })) as EngineeringReadDbRunRow | null;
  }
  if (!referenceRow) {
    const refId = await pickEngineerReferenceRunId(params.userId, {
      id: anchor.id,
      carId: params.carId,
      trackId: anchor.trackId,
      tireSetId: anchor.tireSetId,
      tireRunNumber: anchor.tireRunNumber,
      createdAt: anchor.createdAt,
      sessionCompletedAt: anchor.sessionCompletedAt,
    });
    if (refId) {
      referenceRow = (await prisma.run.findFirst({
        where: { id: refId, userId: params.userId },
        select: engineeringReadRunSelect,
      })) as EngineeringReadDbRunRow | null;
    }
  }

  return buildEngineeringReadV1({
    anchor: rowToInput(anchor),
    reference: referenceRow ? rowToInput(referenceRow) : null,
  });
}
