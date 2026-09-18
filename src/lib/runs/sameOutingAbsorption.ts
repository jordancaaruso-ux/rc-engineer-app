import { sameTimeOnTrack, type Span } from "@/lib/runs/outingSpan";

/**
 * The pure half of folding app-made runs into the driver's own (`absorbSameOutingRuns.ts`).
 */

/** An app-made run that might cover the same race as the one the driver saved. */
export type AbsorbCandidate = {
  id: string;
  /** Its timing sessions' windows on track. */
  spans: readonly Span[];
  /** The driver wrote on it (notes, a rating, handling): theirs now, not the app's to fold away. */
  writtenOn: boolean;
};

/**
 * Which candidates cover the same time on track as the driver's run. Judged strictly
 * (`sameTimeOnTrack`): folding a run in deletes it, so the next heat at the same track must never
 * qualify because the two touch at the changeover.
 */
export function planSameOutingAbsorption(
  runSpans: readonly Span[],
  candidates: readonly AbsorbCandidate[]
): string[] {
  if (runSpans.length === 0) return [];
  return candidates
    .filter(
      (c) => !c.writtenOn && c.spans.some((span) => runSpans.some((own) => sameTimeOnTrack(own, span)))
    )
    .map((c) => c.id);
}

/** True when a person has put something of their own on the run. */
export function runHasDriverWriting(run: {
  notes?: string | null;
  driverNotes?: string | null;
  handlingProblems?: string | null;
  suggestedChanges?: string | null;
  suggestedPreRun?: string | null;
  carRating?: number | null;
  handlingAssessmentJson?: unknown;
}): boolean {
  const texts = [run.notes, run.driverNotes, run.handlingProblems, run.suggestedChanges, run.suggestedPreRun];
  if (texts.some((t) => typeof t === "string" && t.trim().length > 0)) return true;
  if (typeof run.carRating === "number") return true;
  return run.handlingAssessmentJson != null;
}
