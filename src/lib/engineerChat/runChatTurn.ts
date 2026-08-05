import "server-only";

import { loadFullVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";
import {
  ENGINEER_CHAT_SYSTEM_PROMPT,
  ENGINEER_KB_HEADER,
} from "@/lib/engineerChat/prompt";
import {
  buildChatCompletionBody,
  engineerChatModel,
  isContextTooLargeOpenAiError,
  mustGetOpenAiKey,
  postChatCompletion,
  type ChatCompletionMessage,
  type OpenAiUsagePayload,
} from "@/lib/engineerChat/openaiChatClient";

export type EngineerChatMessage = { role: "user" | "assistant"; content: string };

export type EngineerChatUsage = {
  promptTokens: number;
  completionTokens: number;
  completionCalls: number;
  /**
   * Prompt tokens OpenAI served from cache. The KB is ~14K tokens resent every turn, and this
   * is the only evidence that the byte-stable prefix is actually being cached rather than
   * re-billed. Watch it: if it drops to zero, something upstream started varying the prefix.
   */
  cachedPromptTokens: number;
};

/** Per-message ceiling. The route applies the same cap before this ever sees the history. */
const MAX_MESSAGE_CHARS = 4096;

/**
 * The entire Engineer context (v0, 2026-08-05): the KB, the prompt, the conversation.
 *
 * Order matters. The KB goes first and its bytes never vary, so OpenAI's prompt cache can serve
 * the whole ~14K-token prefix on every turn after the first. Anything placed before it — or any
 * per-turn text spliced into it — silently un-caches the corpus and doubles the input bill.
 */
export function buildEngineerChatMessages(
  kbMarkdown: string,
  history: EngineerChatMessage[]
): ChatCompletionMessage[] {
  const safe = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.content.trim().length > 0);

  return [
    { role: "system", content: ENGINEER_KB_HEADER + kbMarkdown },
    { role: "system", content: ENGINEER_CHAT_SYSTEM_PROMPT },
    ...safe,
  ];
}

function readUsage(data: Record<string, unknown> | undefined): EngineerChatUsage | null {
  const u = data?.usage as OpenAiUsagePayload | undefined;
  if (!u || typeof u.prompt_tokens !== "number") return null;
  return {
    promptTokens: u.prompt_tokens,
    completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    completionCalls: 1,
    cachedPromptTokens:
      typeof u.prompt_tokens_details?.cached_tokens === "number"
        ? u.prompt_tokens_details.cached_tokens
        : 0,
  };
}

export async function generateEngineerChatReply(params: {
  messages: EngineerChatMessage[];
  onToken?: (delta: string) => void;
}): Promise<{ reply: string; usage: EngineerChatUsage | null; model: string }> {
  const apiKey = mustGetOpenAiKey();
  const kb = await loadFullVehicleDynamicsKb();
  if (kb.files.length === 0) {
    throw new Error("The vehicle-dynamics knowledge base is empty — the Engineer has nothing to reason from.");
  }

  const { model, temperature } = engineerChatModel();
  let messages = buildEngineerChatMessages(kb.markdown, params.messages);

  let res = await postChatCompletion(
    apiKey,
    buildChatCompletionBody(model, temperature, { messages }),
    params.onToken
  );

  // One degradation, not a ladder. The whole request is ~16K tokens against a 500K-TPM pool, so
  // the only realistic way to be too large is a conversation that has run very long — drop back
  // to the question on its own rather than shrinking the KB, which is the part worth keeping.
  if (!res.ok && isContextTooLargeOpenAiError(res.data)) {
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      console.warn("[engineer-chat] request too large — retrying with the latest question only");
      messages = buildEngineerChatMessages(kb.markdown, [lastUser]);
      res = await postChatCompletion(
        apiKey,
        buildChatCompletionBody(model, temperature, { messages }),
        params.onToken
      );
    }
  }

  if (!res.ok) {
    const rawMsg =
      (res.data?.error as { message?: string } | undefined)?.message ||
      `OpenAI error (${res.status})`;
    throw new Error(engineerOpenAiUserMessage(rawMsg));
  }

  const reply =
    res.streamResult != null
      ? (res.streamResult.content ?? "").trim()
      : (
          (res.data?.choices as Array<{ message?: { content?: string } }> | undefined)?.[0]?.message
            ?.content ?? ""
        ).trim();

  return {
    reply:
      reply ||
      "I couldn't generate a response from the model. Try rephrasing your question.",
    usage: readUsage(res.data),
    model,
  };
}

/**
 * Bench/eval entry point. Keeps the signature the old pipeline had so the harnesses need only a
 * new import path.
 *
 * `runId`, `compareRunId` and `anchor` are accepted and IGNORED. v0 sends no per-car data, so
 * anchoring a bench case to a run no longer changes the answer — every case is now measuring the
 * KB and the prompt. Scores from here are a new baseline and cannot be compared with any run
 * recorded before 2026-08-05.
 */
export async function runEngineerChatTurn(params: {
  userId: string;
  question: string;
  runId?: string;
  compareRunId?: string;
  anchor?: unknown;
  timeZone?: string | null;
  onToken?: (delta: string) => void;
}): Promise<{
  reply: string;
  contextJson: unknown | null;
  resolvedFocus: { runId: string; compareRunId: string | null } | null;
  usage: EngineerChatUsage | null;
  model: string;
}> {
  const out = await generateEngineerChatReply({
    messages: [{ role: "user", content: params.question.trim() }],
    onToken: params.onToken,
  });
  return { ...out, contextJson: null, resolvedFocus: null };
}
