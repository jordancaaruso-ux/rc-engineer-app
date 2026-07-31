/**
 * `/v1/responses` transport for the Engineer tool loop.
 *
 * WHY THIS EXISTS: OpenAI rejects every gpt-5.6 model on `/v1/chat/completions` when function
 * tools are attached, and rejects an explicit `reasoning_effort` alongside tools even on gpt-5.5.
 * Both work on `/v1/responses`. So trying a newer model — or touching the effort knob at all — means
 * moving the tool loop to that endpoint.
 *
 * WHAT THIS IS NOT: a rewrite of the tool loop. The loop keeps building and reading Chat
 * Completions shapes; this module translates at the wire boundary in both directions. That keeps
 * the endpoint swap to one branch in `postChatCompletion`, leaves `addUsage`, the KB-drop ladder,
 * and the error-prose regexes untouched, and makes "same model, both endpoints, same answers" a
 * test you can actually run.
 *
 * Field mapping, for the next person:
 *   messages[]                        -> input[]
 *   {role:"tool", tool_call_id, ...}  -> {type:"function_call_output", call_id, output}
 *   assistant.tool_calls[]            -> {type:"function_call", call_id, name, arguments} items
 *   tools[].function.{name,...}       -> tools[].{name,...}          (nested -> flat)
 *   reasoning_effort                  -> reasoning.effort
 *   usage.prompt_tokens               -> usage.input_tokens
 *   usage.completion_tokens           -> usage.output_tokens
 *   usage.prompt_tokens_details       -> usage.input_tokens_details
 */

/** A tool call in Chat Completions shape — the loop's internal representation. */
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
 * `ENGINEER_API=responses` routes the Engineer through `/v1/responses`.
 *
 * Default (unset) keeps `/v1/chat/completions`, so the shipping path is unchanged until this is
 * deliberately flipped. Read per call rather than cached at module scope so a bench run can set it
 * per arm in-process.
 */
export function responsesApiEnabled(): boolean {
  const raw = process.env.ENGINEER_API?.trim().toLowerCase();
  return raw === "responses";
}

export const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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
      // Any prose the model wrote alongside its tool calls comes first, then one function_call
      // item per call. Dropping empty content matters: Responses rejects a null-content assistant
      // turn, and the loop pushes exactly that whenever the model goes straight to a tool.
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
 * Translate a Chat Completions request body into the Responses equivalent.
 *
 * Only the keys the Engineer actually sends are handled; anything unrecognised is passed through
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
    // The Engineer is stateless — it resends the whole conversation every turn. Persisting each
    // response server-side would add a data-retention surface for no benefit.
    store: false,
  };
  if (tools !== undefined) out.tools = toResponsesTools(tools);
  if (tool_choice !== undefined) out.tool_choice = tool_choice;
  // The reason for the whole port: on Responses, effort and function tools coexist.
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
 * Non-streaming Responses body -> the Chat Completions shape the loop reads.
 *
 * Returns `{choices:[{message:{content, tool_calls}}], usage}` so the call site's
 * `res.data?.choices?.[0]?.message` and `addUsage(res.data)` keep working unchanged.
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
    // Reasoning items carry no readable text (the raw chain of thought is never returned) and are
    // deliberately not echoed back — the loop resends full history each turn, so there is nothing
    // to thread through.
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

/**
 * SSE reader for `/v1/responses`, returning the same shape as the Chat Completions reader.
 *
 * Responses uses named events, but every payload repeats its own name in a `type` field, so this
 * parses `data:` lines only and switches on `type` — same line-splitting as the chat reader.
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
          // Same rule as the chat reader: never stream prose to the user on a round that turns
          // out to be a tool call — that text is the model talking to itself.
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
