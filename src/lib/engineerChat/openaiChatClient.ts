import "server-only";

import { getOpenAiApiKey } from "@/lib/openaiServerEnv";
import {
  computeOpenAiRetryDelayMs,
  engineerOpenAiUserMessage,
  isOpenAiTpmRateLimitError,
  maxOpenAiRateLimitAttempts,
  openAiErrorMessage,
  parseOpenAiRetryAfterMs,
  sleepMs,
} from "@/lib/openAiRetry";
import {
  OPENAI_CHAT_COMPLETIONS_URL,
  OPENAI_RESPONSES_URL,
  readOpenAiResponsesStream,
  responsesToChatCompletion,
  toResponsesBody,
  responsesApiEnabled,
  type ChatCompletionMessage,
  type ChatCompletionStreamResult,
  type OpenAiUsagePayload,
} from "@/lib/engineerPhase5/openaiResponsesApi";

/**
 * HTTP transport for the Engineer's chat completion. Lifted intact from the deleted
 * openaiEngineer.ts — the endpoint switch, retry/backoff and error classification were never
 * the problem with the old pipeline, so they came across unchanged.
 */

export function mustGetOpenAiKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

/**
 * Some models (GPT-5 family, o-series) only allow the default sampler — sending temperature≠1 errors.
 * Omit `temperature` in the request body for those; OpenAI uses its default.
 */
function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * `ENGINEER_REASONING_EFFORT` — unset by default, which keeps the model's own default (medium on
 * gpt-5.5/5.6) and leaves the request body byte-identical to before this knob existed.
 *
 * An unrecognised value is ignored rather than forwarded: a typo here would 400 every Engineer
 * answer, and silently falling back to the model default is the safe failure. Non-GPT-5 models
 * reject the param outright, so it is only ever attached to `gpt-5*`.
 */
export function engineerReasoningEffort(model: string): string | null {
  const raw = process.env.ENGINEER_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw || !REASONING_EFFORTS.has(raw)) return null;
  return model.trim().toLowerCase().startsWith("gpt-5") ? raw : null;
}

/**
 * Model for betweenRunHints, dashboardSuggestions and quickFix. Those three build their own
 * prompts and call `/v1/chat/completions` DIRECTLY — a path OpenAI hard-400s for every gpt-5.6
 * model when tools are attached, and one no bench has covered. They stay on gpt-5.5 until
 * measured. Deliberately NOT the chat model; the two have been confused before.
 */
export const ENGINEER_DEFAULT_MODEL = "gpt-5.5";

/**
 * CHAT-ONLY model (founder decision 2026-08-01, blind pairwise): gpt-5.6-terra beat gpt-5.5
 * 3-1-1 on the stripped prompt at $0.055/answer vs $0.145 and p50 11s vs 21s. terra@medium beat
 * terra@high 2-0-3, so effort stays medium (the env default).
 *
 * NOT a cheap-model breach of ENGINEER_NORTH_STAR.md: that rule was written against gpt-4o-mini.
 * terra is a frontier tier that won the founder's own blind judging outright.
 */
export const ENGINEER_CHAT_MODEL = "gpt-5.6-terra";

export function engineerChatModel(): { model: string; temperature: number } {
  return { model: process.env.ENGINEER_MODEL?.trim() || ENGINEER_CHAT_MODEL, temperature: 0.3 };
}

export function isContextTooLargeOpenAiError(data: Record<string, unknown> | undefined): boolean {
  return /Request too large|maximum context length/i.test(openAiErrorMessage(data));
}

export function buildChatCompletionBody(
  model: string,
  temperature: number,
  rest: Record<string, unknown>
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, ...rest };
  if (modelSupportsCustomTemperature(model)) {
    body.temperature = temperature;
  }
  // MEASURED 2026-07-30: on /v1/chat/completions an explicit reasoning_effort cannot be combined
  // with function tools. v0 sends no tools, so the knob is now live on both endpoints — the
  // condition is kept because ENGINEER_API=chat is still a supported escape hatch.
  const effortAllowed = responsesApiEnabled() || !("tools" in body);
  const effort = effortAllowed ? engineerReasoningEffort(model) : null;
  if (effort) {
    body.reasoning_effort = effort;
  }
  return body;
}

async function readOpenAiChatStream(
  res: Response,
  onToken?: (delta: string) => void
): Promise<ChatCompletionStreamResult> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("OpenAI stream had no body");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: OpenAiUsagePayload | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      // With stream_options.include_usage the final chunk carries usage and an empty `choices`,
      // so read it before the delta guard below skips the chunk. This is what makes the streamed
      // (i.e. real user-facing) path countable against the AI spend cap.
      const chunkUsage = parsed.usage as OpenAiUsagePayload | undefined;
      if (chunkUsage && typeof chunkUsage.prompt_tokens === "number") {
        usage = chunkUsage;
      }
      const choice = (parsed.choices as Array<{ delta?: Record<string, unknown> }> | undefined)?.[0];
      const delta = choice?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        onToken?.(delta.content);
      }
    }
  }

  // No tool-call accumulation: v0 sends no tools, so a tool_calls delta can never arrive.
  return { content: content.length > 0 ? content : null, toolCalls: null, usage };
}

export async function postChatCompletion(
  apiKey: string,
  body: Record<string, unknown>,
  onToken?: (delta: string) => void
): Promise<{
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
  streamResult?: ChatCompletionStreamResult;
}> {
  const useStream = Boolean(onToken);
  const maxAttempts = maxOpenAiRateLimitAttempts();
  // The endpoint is the ONLY thing that changes here. Retry/backoff, the too-large and rate-limit
  // classification, and the returned shape are shared, so the caller cannot tell which endpoint
  // served the answer.
  const responses = responsesApiEnabled();
  const url = responses ? OPENAI_RESPONSES_URL : OPENAI_CHAT_COMPLETIONS_URL;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wireBody = {
      ...body,
      stream: useStream,
      // Ask for the trailing usage chunk so streamed replies are countable against the
      // per-user AI spend cap. Responses reports usage on `response.completed` regardless.
      ...(useStream && !responses ? { stream_options: { include_usage: true } } : {}),
    };
    // The audit instrument. Reading the source tells you what the Engineer COULD send; only a
    // dump tells you what it did. Every past rework that went wrong went wrong because someone
    // inferred the payload instead of looking at it.
    if (process.env.DEBUG_ENGINEER_WIRE === "1") {
      const finalBody = responses ? toResponsesBody(wireBody) : wireBody;
      console.log("[engineer-wire]", JSON.stringify(finalBody, null, 2));
    }
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(responses ? toResponsesBody(wireBody) : wireBody),
    });
    if (useStream) {
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        // "Request too large" never resolves by waiting — surface it so callers can shrink.
        if (
          !isContextTooLargeOpenAiError(data) &&
          isOpenAiTpmRateLimitError(data, res.status) &&
          attempt < maxAttempts - 1
        ) {
          await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
          continue;
        }
        return { ok: false, status: res.status, data };
      }
      const streamResult = responses
        ? await readOpenAiResponsesStream(res, onToken)
        : await readOpenAiChatStream(res, onToken);
      // Shape the streamed usage like a non-stream body so one usage reader serves both paths.
      return {
        ok: true,
        status: res.status,
        streamResult,
        data: streamResult.usage ? { usage: streamResult.usage } : undefined,
      };
    }
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Errors keep their native shape — the classifiers read `error.message` prose, which is
    // identical on both endpoints.
    const data = res.ok && responses ? responsesToChatCompletion(raw) : raw;
    if (res.ok) return { ok: true, status: res.status, data };
    if (
      !isContextTooLargeOpenAiError(data) &&
      isOpenAiTpmRateLimitError(data, res.status) &&
      attempt < maxAttempts - 1
    ) {
      await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
      continue;
    }
    return { ok: false, status: res.status, data };
  }
  return {
    ok: false,
    status: 429,
    data: { error: { message: engineerOpenAiUserMessage("Rate limit exceeded") } },
  };
}

export type { ChatCompletionMessage, OpenAiUsagePayload };
