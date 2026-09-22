/**
 * The shape of what the Engineer may call in one answer — pure, so chat.ts and the eval harness
 * can use it without pulling the database in. The live executor is tools.ts.
 */
export type EngineerTools = {
  /** OpenAI function-tool definitions, Chat Completions shape (openai.ts flattens them for Responses). */
  definitions: unknown[];
  /** Runs one call; the text goes back to the model as the tool result. Never throws. */
  run: (name: string, argumentsJson: string) => Promise<string>;
  /** The chat route turns this into the "Fetching LiveRC results…" status line. */
  onCall?: (name: string) => void;
  /** Called once the results are in and the model is answering again. */
  onAnswering?: () => void;
};

/** How many tool calls one answer may make before the model is told to answer with what it has. */
export const MAX_TOOL_CALLS_PER_ANSWER = 3;
