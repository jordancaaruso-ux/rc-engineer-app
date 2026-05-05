/** Dashboard banner + deep-link shape for event-detected lap sessions (client-safe). */
export type DetectedRunPrompt = {
  eventId: string;
  eventName: string;
  importedLapTimeSessionId: string;
  sourceType: "practice" | "race";
  sessionCompletedAtIso: string;
  /**
   * LiveRC list link text when stored (race: "Race 15: …"; practice: usually driver name).
   */
  sessionListLabel: string | null;
  displayDriverName: string;
  className: string | null;
  lapCount: number | null;
  bestLapSeconds: number | null;
  runId: string | null;
  isIncomplete: boolean;
  promptKind: "log_new" | "finish";
  /** When true, `sessionCompletedAtIso` is import row time — label as "Imported" not on-track session time. */
  sessionTimeIsImportFallback: boolean;
};
