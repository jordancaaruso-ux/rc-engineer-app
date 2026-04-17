import "server-only";

import { prisma } from "@/lib/prisma";
import { buildSetupSpreadForEngineer } from "@/lib/engineerPhase5/setupSpreadForEngineer";
import { searchVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { formatGripTagsForDisplay, formatLayoutTagsForDisplay } from "@/lib/trackMetaTags";
import { encodeTrackConditionSignature } from "@/lib/trackConditionSignature";
import {
  buildConditionalSetupEmpiricalV1,
  type ConditionalSetupEmpiricalV1,
} from "@/lib/engineerPhase5/conditionalSetupForEngineer";

export type EngineerRichContextV1 = {
  version: 1;
  generatedAtIso: string;
  /** Run this context was built from (focused primary or latest). */
  anchorRunId: string | null;
  car: null | {
    id: string;
    name: string;
    chassis: string | null;
    setupSheetTemplate: string | null;
  };
  sessionClass: {
    label: string | null;
    source: "run" | "event" | "none";
  };
  tires: null | {
    id: string;
    label: string;
    setNumber: number;
    tireRunNumber: number;
  };
  track: null | {
    id: string;
    name: string;
    location: string | null;
    gripTags: string[];
    layoutTags: string[];
    gripSummary: string;
    layoutSummary: string;
  };
  setupVsSpread: {
    note: string;
    siblingCarCount: number;
    /** Aggregated from all users’ uploads marked for the aggregation dataset (same sheet template). */
    communitySpreadAvailable: boolean;
    /**
     * Community bucket the engineer is reading from. Grip level resolves from the run's `traction` tag
     * (multi-tag or missing -> `any`). Per-parameter numeric rows may fall back to `any` when the
     * grip-specific bucket had <10 samples — see each row's `communityGripLevel`.
     */
    communityContext: Awaited<
      ReturnType<typeof buildSetupSpreadForEngineer>
    >["communityContext"];
    rows: Awaited<ReturnType<typeof buildSetupSpreadForEngineer>>["rows"];
    truncated: boolean;
  };
  /** Your garage: median tuning values in this track-condition bucket vs overall (runs-based; min sample gate). */
  conditionalSetupEmpirical: ConditionalSetupEmpiricalV1 | null;
  vehicleDynamicsKb: Array<{ title: string; excerpt: string; sourcePath: string }>;
};

const runSelectRich = {
  id: true,
  raceClass: true,
  tireRunNumber: true,
  carId: true,
  trackId: true,
  eventId: true,
  tireSetId: true,
  setupSnapshot: { select: { data: true } },
  car: {
    select: { id: true, name: true, chassis: true, setupSheetTemplate: true },
  },
  track: {
    select: { id: true, name: true, location: true, gripTags: true, layoutTags: true },
  },
  event: { select: { id: true, raceClass: true } },
  tireSet: { select: { id: true, label: true, setNumber: true } },
} as const;

/**
 * Structured engineer context: car, class, tires, track (layout + grip), setup vs historical spread
 * for the same chassis template, plus retrieved vehicle-dynamics KB snippets from the last user message.
 * When `anchorRunId` is null, only KB snippets are populated (still grounded search).
 */
export async function buildEngineerRichContextV1(params: {
  userId: string;
  /** Primary run to anchor; omit for KB-only context. */
  anchorRunId: string | null;
  lastUserMessage: string;
}): Promise<EngineerRichContextV1 | null> {
  const kb = await searchVehicleDynamicsKb(params.lastUserMessage, 5);

  if (!params.anchorRunId?.trim()) {
    if (kb.length === 0) return null;
    return {
      version: 1,
      generatedAtIso: new Date().toISOString(),
      anchorRunId: null,
      car: null,
      sessionClass: { label: null, source: "none" },
      tires: null,
      track: null,
      setupVsSpread: {
        note: "No run anchored — add ?runId= on the Engineer page or log a run for car/setup/track context.",
        siblingCarCount: 0,
        communitySpreadAvailable: false,
        communityContext: {
          setupSheetTemplate: null,
          trackSurface: null,
          gripLevel: "any",
          label: "no run anchored",
        },
        rows: [],
        truncated: false,
      },
      conditionalSetupEmpirical: null,
      vehicleDynamicsKb: kb.map((k) => ({
        title: k.title,
        excerpt: k.excerpt,
        sourcePath: k.sourcePath,
      })),
    };
  }

  const run = await prisma.run.findFirst({
    where: { id: params.anchorRunId.trim(), userId: params.userId },
    select: runSelectRich,
  });
  if (!run) return null;

  const runClassTrim = run.raceClass?.trim() || null;
  const eventClassTrim = run.event?.raceClass?.trim() || null;
  let sessionClass: EngineerRichContextV1["sessionClass"] = { label: null, source: "none" };
  if (runClassTrim) {
    sessionClass = { label: runClassTrim, source: "run" };
  } else if (eventClassTrim) {
    sessionClass = { label: eventClassTrim, source: "event" };
  }

  const spread = await buildSetupSpreadForEngineer({
    userId: params.userId,
    carId: run.carId,
    setupSnapshotData: run.setupSnapshot?.data ?? null,
  });

  const conditionSig = run.track
    ? encodeTrackConditionSignature(run.track.gripTags ?? [], run.track.layoutTags ?? [])
    : "";
  const conditionalSetupEmpirical =
    run.track && run.carId
      ? await buildConditionalSetupEmpiricalV1({
          userId: params.userId,
          carId: run.carId,
          conditionSignature: conditionSig,
          spreadRows: spread.rows,
        })
      : null;

  const garageNote =
    spread.siblingCarIds.length <= 1
      ? "Garage fallback uses setups recorded for this car only (no sibling cars with the same sheet template)."
      : "Garage fallback aggregates your cars that share the same setup sheet template.";
  const communityNote = spread.communitySpreadAvailable
    ? ` Primary numeric bands use the community dataset for ${spread.communityContext.label}: all uploads flagged for aggregations that share this sheet template, bucketed by track surface and grip level. Per-row communityGripLevel tells you which grip bucket actually served that row (it falls back to \"any\" grip when the run's grip bucket has fewer than 10 samples for that parameter). Numeric rows may include gripTrend (partial low/medium/high/any buckets, each with {median, mean, p25, p75, iqr, stdDev, min, max, sampleCount} and n >= 10) PLUS gripTrendSignal (deterministic magnitude verdict fusing Cliff's delta, a per-parameter minimum meaningful delta, and quartile-disjointness → flat/slight/material, with direction and monotonicity). Prefer gripTrendSignal.magnitude over re-deriving whether a change matters; do not narrate trends when magnitude === \"flat\" or meetsMinMeaningfulDelta === false. gripTrendSignal also carries cliffsDelta (−1..+1 effect size, |d|>=0.474 is \"large\"), cliffsInterpretation, and quartilesDisjoint (middle-50% of the two endpoint buckets don't overlap — a very strong non-overlap signal). Spread rows carry mean and iqr alongside the percentiles — flag skew when mean and median disagree by more than half an IQR — and topValues (top-5 exact values in the bucket with count and frequency) plus distinctValueCount. When a single modal value takes >= 50% frequency, report it instead of median (\"most uploads run X, Y% of the bucket\") — more actionable than a smeared central tendency.`
    : " Community spread is unavailable until aggregations are rebuilt or your car has a setupSheetTemplate with eligible uploads.";
  const note =
    `${garageNote}${communityNote}` +
    " Only chassis/suspension tuning parameters are included (excludes motor, pinion, wing, ESC, etc.). Each row includes spreadSource: community_eligible_uploads vs your_garage when numeric bands apply.";

  return {
    version: 1,
    generatedAtIso: new Date().toISOString(),
    anchorRunId: run.id,
    car: run.car
      ? {
          id: run.car.id,
          name: run.car.name,
          chassis: run.car.chassis,
          setupSheetTemplate: run.car.setupSheetTemplate,
        }
      : null,
    sessionClass,
    tires: run.tireSet
      ? {
          id: run.tireSet.id,
          label: run.tireSet.label,
          setNumber: run.tireSet.setNumber,
          tireRunNumber: run.tireRunNumber,
        }
      : null,
    track: run.track
      ? {
          id: run.track.id,
          name: run.track.name,
          location: run.track.location,
          gripTags: run.track.gripTags ?? [],
          layoutTags: run.track.layoutTags ?? [],
          gripSummary: formatGripTagsForDisplay(run.track.gripTags ?? []),
          layoutSummary: formatLayoutTagsForDisplay(run.track.layoutTags ?? []),
        }
      : null,
    setupVsSpread: {
      note,
      siblingCarCount: spread.siblingCarIds.length,
      communitySpreadAvailable: spread.communitySpreadAvailable,
      communityContext: spread.communityContext,
      rows: spread.rows,
      truncated: spread.truncated,
    },
    conditionalSetupEmpirical,
    vehicleDynamicsKb: kb.map((k) => ({
      title: k.title,
      excerpt: k.excerpt,
      sourcePath: k.sourcePath,
    })),
  };
}
