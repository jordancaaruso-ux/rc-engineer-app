/** Cached payload for Dashboard “Engineer suggestions” tab (LLM + fingerprint). */
export type DashboardEngineerSuggestionPayloadV1 = {
  version: 1;
  generatedAtIso: string;
  primaryRunId: string;
  headline: string;
  bullets: string[];
  /** Short checklist for the next outing (may be empty). */
  tryNextSession: string[];
  /** One-line provenance for the driver. */
  sourcesNote: string;
  /** Deep link to Engineer with this run focused. */
  engineerHref: string;
};
