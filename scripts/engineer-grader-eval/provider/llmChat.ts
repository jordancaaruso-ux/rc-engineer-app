/**
 * Minimal OpenAI-compatible chat-completion caller for the grader-eval harness.
 *
 * Non-streaming, no tools — used for eval-only work: scenario generation, the
 * coherence gate, the reason-agreement classifier, and (Phase 3) Grok-as-candidate-
 * judge. Reuses the shared 429/TPM backoff from src/lib/openAiRetry.ts. NOT the path
 * the Engineer answers on — that stays the real tool loop in src/lib.
 */
import {
  computeOpenAiRetryDelayMs,
  isOpenAiTpmRateLimitError,
  maxOpenAiRateLimitAttempts,
  parseOpenAiRetryAfterMs,
  sleepMs,
} from "@/lib/openAiRetry";
import { resolveProvider, type LlmProviderId } from "./resolveProvider";

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmChatOptions = {
  /** Defaults to "openai". */
  provider?: LlmProviderId;
  model: string;
  messages: LlmMessage[];
  /** Omitted for gpt-5/o-series (they reject it); pass explicitly otherwise. */
  temperature?: number;
  /** Sets response_format:{type:"json_object"} — provider must support it. */
  responseFormatJson?: boolean;
};

export type LlmChatResult = {
  content: string;
  usage: { promptTokens: number; completionTokens: number } | null;
  provider: LlmProviderId;
  model: string;
};

type RawCompletion = {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** One OpenAI-compatible chat completion with shared TPM backoff. */
export async function llmChat(opts: LlmChatOptions): Promise<LlmChatResult> {
  const provider = opts.provider ?? "openai";
  const { baseUrl, apiKey, label } = resolveProvider(provider);

  const body = JSON.stringify({
    model: opts.model,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.responseFormatJson ? { response_format: { type: "json_object" } } : {}),
    messages: opts.messages,
  });

  const maxAttempts = maxOpenAiRateLimitAttempts();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as RawCompletion;
    if (!res.ok) {
      if (isOpenAiTpmRateLimitError(data, res.status) && attempt < maxAttempts - 1) {
        await sleepMs(computeOpenAiRetryDelayMs(parseOpenAiRetryAfterMs(data), attempt));
        continue;
      }
      throw new Error(data.error?.message ?? `${label} chat error (${res.status})`);
    }
    return {
      content: data.choices?.[0]?.message?.content ?? "",
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : null,
      provider,
      model: opts.model,
    };
  }
  throw new Error(`${label} rate-limited after retries`);
}

/** Parse a JSON object out of a model reply, tolerating ```json fences / prose wrap. */
export function parseJsonLoose<T = Record<string, unknown>>(content: string): T | null {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
