import "server-only";

import { loadFullVehicleDynamicsKb } from "@/lib/engineer/kb";
import { engineerOpenAiUserMessage } from "@/lib/openAiRetry";
import {
  buildEngineerMessages,
  standardEngineerBlocks,
  type EngineerChatMessage,
  type EngineerPayloadBlock,
} from "@/lib/engineer/payload";
import {
  buildChatCompletionBody,
  engineerChatModel,
  isContextTooLargeOpenAiError,
  mustGetOpenAiKey,
  postChatCompletion,
  type OpenAiUsagePayload,
} from "@/lib/engineer/openai";

export type EngineerChatUsage = {
  promptTokens: number;
  completionTokens: number;
  completionCalls: number;
  /**
   * Prompt tokens OpenAI served from cache. The KB is ~14K tokens resent every turn, and
   * this is the only evidence that the byte-stable prefix is actually being cached rather
   * than re-billed. Watch it: if it drops to zero, something upstream started varying the
   * prefix.
   */
  cachedPromptTokens: number;
};

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
  /**
   * Payload override for the eval harness — an "arm" supplies its own ordered blocks.
   * Omitted (the shipped path) means the standard KB + prompt payload.
   */
  blocks?: EngineerPayloadBlock[];
}): Promise<{ reply: string; usage: EngineerChatUsage | null; model: string }> {
  const apiKey = mustGetOpenAiKey();
  const kb = await loadFullVehicleDynamicsKb();
  if (kb.files.length === 0) {
    throw new Error("The vehicle-dynamics knowledge base is empty — the Engineer has nothing to reason from.");
  }

  const blocks = params.blocks ?? standardEngineerBlocks(kb.markdown);
  const { model, temperature } = engineerChatModel();
  let messages = buildEngineerMessages(blocks, params.messages);

  let res = await postChatCompletion(
    apiKey,
    buildChatCompletionBody(model, temperature, { messages }),
    params.onToken
  );

  // One degradation, not a ladder. The whole request is ~16K tokens against a 500K-TPM
  // pool, so the only realistic way to be too large is a conversation that has run very
  // long — drop back to the question on its own rather than shrinking the KB, which is the
  // part worth keeping.
  if (!res.ok && isContextTooLargeOpenAiError(res.data)) {
    const lastUser = [...params.messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      console.warn("[engineer-chat] request too large — retrying with the latest question only");
      messages = buildEngineerMessages(blocks, [lastUser]);
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
 * Eval-harness entry point: one question in, one answer out, with an optional payload
 * override so an arm can swap the prompt or add blocks without touching the shipped path.
 */
export async function runEngineerChatTurn(params: {
  question: string;
  blocks?: EngineerPayloadBlock[];
  onToken?: (delta: string) => void;
}): Promise<{ reply: string; usage: EngineerChatUsage | null; model: string }> {
  return generateEngineerChatReply({
    messages: [{ role: "user", content: params.question.trim() }],
    blocks: params.blocks,
    onToken: params.onToken,
  });
}
