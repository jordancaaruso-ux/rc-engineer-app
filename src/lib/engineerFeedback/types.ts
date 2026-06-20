export type EngineerMessageContextSnapshot = {
  question?: string;
  answer?: string;
  runId?: string | null;
  compareRunId?: string | null;
  setupIds?: string[];
  kbSections?: string[];
  source?: string;
  capturedAtIso?: string;
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
