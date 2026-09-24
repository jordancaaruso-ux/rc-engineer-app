export type EngineerMessageContextSnapshot = {
  question?: string;
  answer?: string;
  runId?: string | null;
  compareRunId?: string | null;
  /** The range the Engineer read instead of a run (rangeScope.ts), when the subject was a range. */
  range?: {
    eventId?: string | null;
    trackId: string | null;
    carId: string | null;
    from: string | null;
    to: string | null;
  } | null;
  source?: string;
  capturedAtIso?: string;
  /** Engineer build that produced the answer — see engineer/prompt.ts. */
  promptVersion?: string;
  /** The model that wrote it; the prompt version alone can't tell a Terra answer from a Sol one. */
  model?: string;
  /** The follow-up buttons the Engineer picked for this answer (nextQuestions.ts). */
  nextQuestions?: string[];
};

export type EngineerRatingInput = {
  stars: number;
  note?: string | null;
  contextSnapshot?: EngineerMessageContextSnapshot | null;
};

export type PersistedChatExchange = {
  threadId: string;
  assistantMessageId: string;
  ratingContext: EngineerMessageContextSnapshot;
};
