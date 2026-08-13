export type EngineerMessageContextSnapshot = {
  question?: string;
  answer?: string;
  runId?: string | null;
  compareRunId?: string | null;
  source?: string;
  capturedAtIso?: string;
  /** Engineer build that produced the answer — see engineer/prompt.ts. */
  promptVersion?: string;
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
