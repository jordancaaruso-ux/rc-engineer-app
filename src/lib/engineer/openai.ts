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

/**
 * OpenAI transport for the Engineer: model selection, retry/backoff, both endpoints
 * (`/v1/chat/completions` and `/v1/responses`) behind one call, and the wire dump.
 *
 * Merged in the 2026-08-13 rebuild from the deleted engineerChat/openaiChatClient.ts and
 * engineerPhase5/openaiResponsesApi.ts — the transport was never the problem with any old
 * pipeline, so it came across unchanged.
 *
 * DEBUG_ENGINEER_WIRE=1 dumps the exact final request body. This is the audit instrument:
 * reading the source tells you what the Engineer COULD send; only a dump tells you what it
 * did. Every past rework that went wrong went wrong because someone inferred the payload
 * instead of looking at it.
 */

/** A tool call in Chat Completions shape — kept so the Responses adapter stays complete. */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatCompletionMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type OpenAiUsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

export type ChatCompletionStreamResult = {
  content: string | null;
  toolCalls: ToolCall[] | null;
  /** Present only when the request asked for stream_options.include_usage. */
  usage?: OpenAiUsagePayload;
};

/**
 * `ENGINEER_API=responses` (the default) routes through `/v1/responses`; `ENGINEER_API=chat`
 * is the escape hatch (only usable with a gpt-5.5-or-older ENGINEER_MODEL override — OpenAI
 * hard-400s gpt-5.6 models on chat/completions when function tools are attached). Read per
 * call rather than cached at module scope so an eval run can set it per arm in-process.
 */
export function responsesApiEnabled(): boolean {
  const raw = process.env.ENGINEER_API?.trim().toLowerCase();
  return raw !== "chat";
}

export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export function mustGetOpenAiKey(): string {
  const k = getOpenAiApiKey();
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

/**
 * Some models (GPT-5 family, o-series) only allow the default sampler — sending
 * temperature≠1 errors. Omit `temperature` in the request body for those.
 */
function modelSupportsCustomTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * `ENGINEER_REASONING_EFFORT` — unset by default, which keeps the model's own default and
 * leaves the request body byte-identical to before this knob existed. An unrecognised value
 * is ignored rather than forwarded: a typo here would 400 every Engineer answer. Non-GPT-5
 * models reject the param outright, so it is only ever attached to `gpt-5*`.
 */
export function engineerReasoningEffort(model: string): string | null {
  const raw = process.env.ENGINEER_REASONING_EFFORT?.trim().toLowerCase();
  if (!raw || !REASONING_EFFORTS.has(raw)) return null;
  return model.trim().toLowerCase().startsWith("gpt-5") ? raw : null;
}

/**
 * CHAT model (founder decision 2026-08-01, blind pairwise): gpt-5.6-terra beat gpt-5.5
 * 3-1-1 on the stripped prompt at $0.055/answer vs $0.145 and p50 11s vs 21s. terra@medium
 * beat terra@high 2-0-3, so effort stays medium (the env default). The rebuild's model
 * bench (any provider, harness decides) may replace this.
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
  // MEASURED 2026-07-30: on /v1/chat/completions an explicit reasoning_effort cannot be
  // combined with function tools. The Engineer sends no tools, so the knob is live on both
  // endpoints — the condition is kept because ENGINEER_API=chat is still a supported escape hatch.
  const effortAllowed = responsesApiEnabled() || !("tools" in body);
  const effort = effortAllowed ? engineerReasoningEffort(model) : null;
  if (effort) {
    body.reasoning_effort = effort;
  }
  return body;
}

type ResponsesInputItem =
  | { role: "system" | "developer" | "user" | "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

/** Chat `messages[]` -> Responses `input[]`. */
function toResponsesInput(messages: ChatCompletionMessage[]): ResponsesInputItem[] {
  const input: ResponsesInputItem[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
      continue;
    }
    if (m.role === "assistant") {
      // Any prose the model wrote alongside its tool calls comes first, then one
      // function_call item per call. Dropping empty content matters: Responses rejects a
      // null-content assistant turn.
      if (typeof m.content === "string" && m.content.length > 0) {
        input.push({ role: "assistant", content: m.content });
      }
      for (const tc of m.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
      continue;
    }
    input.push({ role: m.role, content: m.content });
  }
  return input;
}

/** Chat nested tool defs -> Responses flat tool defs. */
function toResponsesTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) return tools;
  return tools.map((t) => {
    const tool = t as { type?: string; function?: Record<string, unknown> };
    if (tool.type !== "function" || !tool.function) return t;
    return { type: "function", ...tool.function };
  });
}

/**
 * Translate a Chat Completions request body into the Responses equivalent. Only the keys
 * the Engineer actually sends are handled; anything unrecognised is passed through
 * untouched so an unmapped key surfaces as an API error rather than being silently dropped.
 */
export function toResponsesBody(body: Record<string, unknown>): Record<string, unknown> {
  const {
    messages,
    tools,
    tool_choice,
    reasoning_effort,
    temperature,
    stream,
    stream_options: _streamOptions,
    ...rest
  } = body as Record<string, unknown> & { messages?: ChatCompletionMessage[] };

  const out: Record<string, unknown> = {
    ...rest,
    input: toResponsesInput(messages ?? []),
    // The Engineer is stateless — it resends the whole conversation every turn. Persisting
    // each response server-side would add a data-retention surface for no benefit.
    store: false,
  };
  if (tools !== undefined) out.tools = toResponsesTools(tools);
  if (tool_choice !== undefined) out.tool_choice = tool_choice;
  // On Responses, effort and function tools coexist.
  if (typeof reasoning_effort === "string") out.reasoning = { effort: reasoning_effort };
  if (temperature !== undefined) out.temperature = temperature;
  if (stream !== undefined) out.stream = stream;
  // stream_options.include_usage has no analogue — Responses always reports usage on
  // response.completed, so the streamed path stays countable against the spend cap for free.
  return out;
}

function toChatUsage(usage: unknown): OpenAiUsagePayload | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  if (typeof u.input_tokens !== "number") return undefined;
  return {
    prompt_tokens: u.input_tokens,
    completion_tokens: u.output_tokens,
    prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens },
  };
}

/**
 * Non-streaming Responses body -> the Chat Completions shape callers read:
 * `{choices:[{message:{content, tool_calls}}], usage}`.
 */
export function responsesToChatCompletion(data: Record<string, unknown>): Record<string, unknown> {
  const output = Array.isArray(data.output) ? (data.output as Array<Record<string, unknown>>) : [];
  let content = "";
  const toolCalls: ToolCall[] = [];

  for (const item of output) {
    if (item.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id ?? ""),
        type: "function",
        function: {
          name: String(item.name ?? ""),
          arguments: typeof item.arguments === "string" ? item.arguments : "{}",
        },
      });
      continue;
    }
    if (item.type === "message") {
      const parts = Array.isArray(item.content) ? (item.content as Array<Record<string, unknown>>) : [];
      for (const part of parts) {
        if (part.type === "output_text" && typeof part.text === "string") content += part.text;
      }
    }
    // Reasoning items carry no readable text and are deliberately not echoed back.
  }

  const usage = toChatUsage(data.usage);
  return {
    choices: [
      {
        message: {
          content: content.length > 0 ? content : null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  };
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
      // With stream_options.include_usage the final chunk carries usage and an empty
      // `choices`, so read it before the delta guard below skips the chunk. This is what
      // makes the streamed (i.e. real user-facing) path countable against the AI spend cap.
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

  // No tool-call accumulation: the Engineer sends no tools, so a tool_calls delta can never arrive.
  return { content: content.length > 0 ? content : null, toolCalls: null, usage };
}

/**
 * SSE reader for `/v1/responses`, returning the same shape as the Chat Completions reader.
 * Responses uses named events, but every payload repeats its own name in a `type` field, so
 * this parses `data:` lines only and switches on `type`.
 */
export async function readOpenAiResponsesStream(
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
  let sawToolCalls = false;
  // Keyed by the item id the deltas reference; insertion order is emission order.
  const callsByItemId = new Map<string, ToolCall>();

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
      const type = typeof parsed.type === "string" ? parsed.type : "";

      if (type === "response.output_text.delta") {
        const delta = typeof parsed.delta === "string" ? parsed.delta : "";
        if (delta.length > 0) {
          content += delta;
          // Never stream prose to the user on a round that turns out to be a tool call —
          // that text is the model talking to itself.
          if (onToken && !sawToolCalls) onToken(delta);
        }
        continue;
      }

      if (type === "response.output_item.added") {
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          sawToolCalls = true;
          const itemId = String(item.id ?? parsed.item_id ?? "");
          callsByItemId.set(itemId, {
            id: String(item.call_id ?? ""),
            type: "function",
            function: { name: String(item.name ?? ""), arguments: "" },
          });
        }
        continue;
      }

      if (type === "response.function_call_arguments.delta") {
        const itemId = String(parsed.item_id ?? "");
        const existing = callsByItemId.get(itemId);
        if (existing && typeof parsed.delta === "string") {
          existing.function.arguments += parsed.delta;
        }
        continue;
      }

      if (type === "response.function_call_arguments.done") {
        // Authoritative full string — prefer it over the accumulated deltas.
        const itemId = String(parsed.item_id ?? "");
        const existing = callsByItemId.get(itemId);
        if (existing && typeof parsed.arguments === "string") {
          existing.function.arguments = parsed.arguments;
        }
        continue;
      }

      if (type === "response.output_item.done") {
        // Backstop: if the item was never announced via output_item.added (ordering differs
        // between models), capture it here so the call isn't silently lost.
        const item = parsed.item as Record<string, unknown> | undefined;
        if (item?.type === "function_call") {
          sawToolCalls = true;
          const itemId = String(item.id ?? parsed.item_id ?? "");
          callsByItemId.set(itemId, {
            id: String(item.call_id ?? ""),
            type: "function",
            function: {
              name: String(item.name ?? ""),
              arguments: typeof item.arguments === "string" ? item.arguments : "{}",
            },
          });
        }
        continue;
      }

      if (
        type === "response.completed" ||
        type === "response.incomplete" ||
        type === "response.failed"
      ) {
        const response = parsed.response as Record<string, unknown> | undefined;
        const u = toChatUsage(response?.usage);
        if (u) usage = u;
      }
    }
  }

  const toolCalls = [...callsByItemId.values()].filter((tc) => tc.function.name.length > 0);

  return {
    content: content.length > 0 ? content : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage,
  };
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
  // The endpoint is the ONLY thing that changes here. Retry/backoff, the too-large and
  // rate-limit classification, and the returned shape are shared, so the caller cannot tell
  // which endpoint served the answer.
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
    // The audit instrument — see the file header.
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
