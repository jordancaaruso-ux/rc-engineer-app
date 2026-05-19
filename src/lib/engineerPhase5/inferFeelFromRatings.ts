/**
 * Infer feel-vs-last-run when the better/worse chip is unset, using required car ratings.
 */

import type { PhaseBalance } from "@/lib/runHandlingAssessment";

export type InferredFeelDirection = "better" | "worse" | "same" | "unknown";

export type InferredFeelVsReference = {
  direction: InferredFeelDirection;
  /** Synthetic chip-scale value in [-3, 3] when inferred from rating delta. */
  value: PhaseBalance | null;
  magnitudeWord: "mild" | "moderate" | "strong" | null;
};

function magnitudeWordFromDelta(absDelta: number): "mild" | "moderate" | "strong" | null {
  if (absDelta <= 0) return null;
  if (absDelta === 1) return "mild";
  if (absDelta === 2) return "moderate";
  return "strong";
}

/**
 * Compare anchor rating to reference rating. Returns null when inference is not possible
 * (missing ratings or chip already set by caller).
 */
export function inferFeelVsReferenceFromRatings(
  currentRating: number | null | undefined,
  referenceRating: number | null | undefined
): InferredFeelVsReference | null {
  if (typeof currentRating !== "number" || typeof referenceRating !== "number") return null;
  if (!Number.isFinite(currentRating) || !Number.isFinite(referenceRating)) return null;

  const delta = currentRating - referenceRating;
  if (delta === 0) {
    return { direction: "same", value: 0, magnitudeWord: null };
  }

  const abs = Math.abs(delta);
  const value = (delta > 0 ? 1 : -1) * Math.min(3, abs) as PhaseBalance;
  return {
    direction: delta > 0 ? "better" : "worse",
    value,
    magnitudeWord: magnitudeWordFromDelta(abs),
  };
}
