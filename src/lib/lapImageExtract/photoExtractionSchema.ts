/**
 * Schema-constrained shape for vision model JSON output (photo / screenshot lap read).
 */

export type PhotoLapExtractionConfidence = "high" | "medium" | "low";

export interface PhotoLapExtractionV1 {
  laps: number[];
  notes?: string | null;
  confidence: PhotoLapExtractionConfidence;
}

const CONFIDENCE_SET = new Set<PhotoLapExtractionConfidence>(["high", "medium", "low"]);

export function normalizeAndValidatePhotoExtraction(raw: unknown): PhotoLapExtractionV1 {
  if (!raw || typeof raw !== "object") {
    return { laps: [], notes: "Invalid model response.", confidence: "low" };
  }
  const o = raw as Record<string, unknown>;
  const lapsRaw = o.laps;
  const laps: number[] = Array.isArray(lapsRaw)
    ? lapsRaw
        .map((x) => (typeof x === "number" ? x : Number(x)))
        .filter((n) => Number.isFinite(n) && n > 0 && n < 600)
    : [];
  const notes = o.notes == null ? null : String(o.notes);
  const c = o.confidence;
  const confidence: PhotoLapExtractionConfidence =
    typeof c === "string" && CONFIDENCE_SET.has(c as PhotoLapExtractionConfidence)
      ? (c as PhotoLapExtractionConfidence)
      : "medium";
  return { laps, notes, confidence };
}
