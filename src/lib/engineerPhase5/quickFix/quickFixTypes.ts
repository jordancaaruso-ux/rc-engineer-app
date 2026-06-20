export type QuickFixMagnitudeTier = "big" | "moderate" | "fine" | "minimal";

export type QuickFixConfidence = "high" | "medium" | "low";

export type QuickFixSuggestionV1 = {
  parameter: string;
  direction: string;
  amount: string;
  kbWhy: string;
  confidence: QuickFixConfidence;
  expectedEffect: string;
  priority: number;
};

export type QuickFixPayloadV1 = {
  version: 1;
  generatedAtIso: string;
  runId: string;
  runLabel: string;
  magnitudeTier: QuickFixMagnitudeTier;
  magnitudeNote: string;
  inferredIssue: string | null;
  suggestions: QuickFixSuggestionV1[];
  thinContextNote: string;
  digDeeperPrompt: string;
  engineerHref: string;
};
