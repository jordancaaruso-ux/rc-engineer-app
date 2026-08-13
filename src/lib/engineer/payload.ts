import type { ChatCompletionMessage } from "@/lib/engineer/openai";
import { ENGINEER_CHAT_SYSTEM_PROMPT, ENGINEER_KB_HEADER } from "@/lib/engineer/prompt";

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

/**
 * One system-message block in the Engineer payload.
 *
 * `cacheStable` is the load-bearing bit: a stable block's bytes never vary between turns,
 * so OpenAI's prompt cache can serve the whole prefix on every turn after the first.
 * Anything placed before a stable block — or any per-turn text spliced into one — silently
 * un-caches the corpus and doubles the input bill.
 */
export type EngineerPayloadBlock = {
  /** "kb" | "nets" | "prompt" today; driver-data blocks slot in later without a rework. */
  id: string;
  cacheStable: boolean;
  content: string;
};

/** Per-message ceiling. The route applies the same cap before this ever sees the history. */
const MAX_MESSAGE_CHARS = 4096;

/**
 * The standard shipped payload: the KB (header + full corpus, cache-stable) and the prompt
 * (cache-stable). Exactly v0's two system messages.
 */
export function standardEngineerBlocks(kbMarkdown: string): EngineerPayloadBlock[] {
  return [
    { id: "kb", cacheStable: true, content: ENGINEER_KB_HEADER + kbMarkdown },
    { id: "prompt", cacheStable: true, content: ENGINEER_CHAT_SYSTEM_PROMPT },
  ];
}

/**
 * The entire Engineer context: ordered blocks, then the conversation.
 *
 * The order rule is enforced, not documented: every cache-stable block must precede every
 * per-turn block, and the history always comes last. A violation throws — the old pipeline
 * grew to ~99K chars a turn one reasonable-looking addition at a time because nothing ever
 * failed when a block was added in the wrong place.
 */
export function buildEngineerMessages(
  blocks: EngineerPayloadBlock[],
  history: EngineerChatMessage[]
): ChatCompletionMessage[] {
  let sawPerTurn = false;
  for (const b of blocks) {
    if (!b.cacheStable) {
      sawPerTurn = true;
    } else if (sawPerTurn) {
      throw new Error(
        `Engineer payload block "${b.id}" is cache-stable but placed after a per-turn block — this un-caches the prefix`
      );
    }
  }

  const safe = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim().length > 0);

  return [
    ...blocks
      .filter((b) => b.content.trim().length > 0)
      .map((b) => ({ role: "system" as const, content: b.content })),
    ...safe,
  ];
}
