import type { EngineerRunSummaryV2 } from "@/lib/engineerPhase5/engineerRunSummaryTypes";
import { computeLapOutcomesForEngineer } from "@/lib/engineerPhase5/computeLapOutcomesForEngineer";
import { rankSetupChangesForEngineer } from "@/lib/engineerPhase5/rankSetupChangesForEngineer";
import { buildTemplateInterpretation } from "@/lib/engineerPhase5/buildTemplateInterpretation";
import { shouldOfferEngineerDeepDive } from "@/lib/engineerPhase5/engineerDeepDiveTriggers";
import { softPriorsForSetupChanges } from "@/lib/engineerPhase5/softPriorsFromAggregation";
import { getEffectiveRunNotes } from "@/lib/engineerPhase5/mergeRunNotes";
import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { formatRunSessionDisplay } from "@/lib/runSession";
import { loadNumericAggregationMapForCar } from "@/lib/engineerPhase5/loadNumericAggregationMapForCar";
import type { FieldImportSession } from "@/lib/lapField/fieldImportSession";

const SNIPPET_MAX = 120;

export type RunShapeForEngineer = {
  id: string;
  lapTimes: unknown;
  lapSession?: unknown;
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  handlingAssessmentJson?: unknown;
  sessionType?: string;
  meetingSessionType?: string | null;
  meetingSessionCode?: string | null;
  sessionLabel?: string | null;
  createdAt: Date;
  carId?: string | null;
  setupSnapshot: { data: unknown } | null;
};

function referenceLabelFromRun(run: RunShapeForEngineer): string {
  const session = formatRunSessionDisplay({
    sessionType: run.sessionType ?? "TESTING",
    meetingSessionType: run.meetingSessionType ?? null,
    meetingSessionCode: run.meetingSessionCode ?? null,
    sessionLabel: run.sessionLabel ?? null,
  });
  return `${formatRunCreatedAtDateTime(run.createdAt)} · ${session}`;
}

function importedProvenanceLine(input: {
  sourceUrl: string;
  eventDetectionSessionLabel: string | null;
} | null): string | null {
  if (!input) return null;
  try {
    const host = new URL(input.sourceUrl).hostname.replace(/^www\./, "");
    if (input.eventDetectionSessionLabel?.trim()) {
      return `${host} · ${input.eventDetectionSessionLabel.trim()}`;
    }
    return host;
  } catch {
    return input.eventDetectionSessionLabel?.trim() || "Imported session";
  }
}

/**
 * Build deterministic Engineer Summary for a current run vs optional reference run.
 */
export async function buildEngineerRunSummary(params: {
  current: RunShapeForEngineer;
  reference: RunShapeForEngineer | null;
  importedSession: { sourceUrl: string; eventDetectionSessionLabel: string | null } | null;
  fieldImportSession: FieldImportSession | null;
  fieldFingerprint: string;
}): Promise<EngineerRunSummaryV2> {
  const { lapOutcome, lapCountIncluded } = computeLapOutcomesForEngineer(
    params.current,
    params.reference
  );

  const aggMap = params.current.carId
    ? await loadNumericAggregationMapForCar(params.current.carId)
    : new Map();

  const setupChanges = params.reference
    ? rankSetupChangesForEngineer(
        params.current.setupSnapshot?.data,
        params.reference.setupSnapshot?.data,
        aggMap
      )
    : [];

  const effectiveNotes = getEffectiveRunNotes(params.current);
  const verbatimSnippet =
    effectiveNotes.length > SNIPPET_MAX
      ? `${effectiveNotes.slice(0, SNIPPET_MAX - 1)}…`
      : effectiveNotes || null;

  const softPriors =
    params.current.carId && setupChanges.length > 0
      ? await softPriorsForSetupChanges(params.current.carId, setupChanges)
      : [];

  const base: EngineerRunSummaryV2 = {
    version: 2,
    currentRunId: params.current.id,
    referenceRunId: params.reference?.id ?? null,
    referenceLabel: params.reference ? referenceLabelFromRun(params.reference) : null,
    lapOutcome,
    lapCountIncluded,
    setupChanges,
    interpretation: "",
    notesUsed: {
      verbatimSnippet: effectiveNotes ? verbatimSnippet : null,
      role: effectiveNotes ? "context_only" : "none",
    },
    importedProvenance: importedProvenanceLine(params.importedSession),
    fieldImportSession: params.fieldImportSession
      ? {
          sessionBestLapSeconds: params.fieldImportSession.sessionBestLapSeconds,
          ranked: params.fieldImportSession.ranked.map((r) => ({
            label: r.label,
            isPrimaryUser: r.isPrimaryUser,
            rank: r.rank,
            bestLapSeconds: r.bestLapSeconds,
            gapToSessionBestSeconds: r.gapToSessionBestSeconds,
            fadeSeconds: r.fadeSeconds,
          })),
        }
      : null,
    fieldFingerprint: params.fieldFingerprint,
    deepDiveOffered: false,
    softPriors,
  };

  base.interpretation = buildTemplateInterpretation(base, params.current);
  base.deepDiveOffered = shouldOfferEngineerDeepDive(base, params.current);

  return base;
}
