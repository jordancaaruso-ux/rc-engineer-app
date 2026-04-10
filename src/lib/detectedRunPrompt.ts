/** Dashboard banner + deep-link shape for event-detected lap sessions (client-safe). */
export type DetectedRunPrompt = {
  eventId: string;
  eventName: string;
  importedLapTimeSessionId: string;
  sourceType: "practice" | "race";
  sessionCompletedAtIso: string;
  displayDriverName: string;
  className: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
  runId: string | null;
  isIncomplete: boolean;
  promptKind: "log_new" | "finish";
};
