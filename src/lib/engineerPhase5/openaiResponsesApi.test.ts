/**
 * Run: `npm run test:engineer-responses-api`
 *
 * The Responses port swaps the wire format under an unchanged tool loop. A shape error here is
 * silent — the request still 200s, the model just never sees a tool result, or the loop never sees
 * a tool call — so the translation is tested directly rather than trusted.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readOpenAiResponsesStream,
  responsesToChatCompletion,
  toResponsesBody,
  responsesApiEnabled,
  type ChatCompletionMessage,
} from "@/lib/engineerPhase5/openaiResponsesApi";

test("the endpoint flag defaults to Responses; ENGINEER_API=chat is the escape hatch", () => {
  // Default flipped 2026-08-01: the shipping chat model (gpt-5.6-terra) is hard-rejected on
  // chat/completions when tools are attached, so Responses is the default, not the opt-in.
  const prev = process.env.ENGINEER_API;
  delete process.env.ENGINEER_API;
  assert.equal(responsesApiEnabled(), true);
  process.env.ENGINEER_API = "chat";
  assert.equal(responsesApiEnabled(), false);
  process.env.ENGINEER_API = "CHAT";
  assert.equal(responsesApiEnabled(), false);
  process.env.ENGINEER_API = "responses";
  assert.equal(responsesApiEnabled(), true);
  process.env.ENGINEER_API = "RESPONSES";
  assert.equal(responsesApiEnabled(), true);
  if (prev === undefined) delete process.env.ENGINEER_API;
  else process.env.ENGINEER_API = prev;
});

test("tool definitions flatten from nested to top-level", () => {
  const body = toResponsesBody({
    model: "gpt-5.6-luna",
    messages: [],
    tools: [
      {
        type: "function",
        function: {
          name: "kb_search",
          description: "Search the KB",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      },
    ],
    tool_choice: "auto",
  });
  assert.deepEqual(body.tools, [
    {
      type: "function",
      name: "kb_search",
      description: "Search the KB",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    },
  ]);
  assert.equal(body.tool_choice, "auto");
});

test("a tool round trip maps to function_call + function_call_output on call_id", () => {
  const messages: ChatCompletionMessage[] = [
    { role: "system", content: "rules" },
    { role: "user", content: "why is it loose?" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_abc", type: "function", function: { name: "kb_search", arguments: '{"query":"loose"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call_abc", content: '{"hits":[]}' },
  ];
  const body = toResponsesBody({ model: "gpt-5.6-terra", messages });
  assert.deepEqual(body.input, [
    { role: "system", content: "rules" },
    { role: "user", content: "why is it loose?" },
    { type: "function_call", call_id: "call_abc", name: "kb_search", arguments: '{"query":"loose"}' },
    { type: "function_call_output", call_id: "call_abc", output: '{"hits":[]}' },
  ]);
});

test("a null-content assistant turn emits no assistant item", () => {
  // The loop pushes {role:"assistant", content:null, tool_calls:[...]} whenever the model goes
  // straight to a tool. Responses rejects a null-content message, so it must be dropped, not sent.
  const body = toResponsesBody({
    model: "gpt-5.5",
    messages: [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "t", arguments: "{}" } }],
      },
    ] as ChatCompletionMessage[],
  });
  assert.deepEqual(body.input, [{ type: "function_call", call_id: "c1", name: "t", arguments: "{}" }]);
});

test("prose alongside tool calls is preserved, and ordered before them", () => {
  const body = toResponsesBody({
    model: "gpt-5.5",
    messages: [
      {
        role: "assistant",
        content: "Let me check the spread.",
        tool_calls: [{ id: "c1", type: "function", function: { name: "get_param_spread", arguments: "{}" } }],
      },
    ] as ChatCompletionMessage[],
  });
  assert.deepEqual(body.input, [
    { role: "assistant", content: "Let me check the spread." },
    { type: "function_call", call_id: "c1", name: "get_param_spread", arguments: "{}" },
  ]);
});

test("reasoning_effort becomes reasoning.effort — the whole point of the port", () => {
  const body = toResponsesBody({ model: "gpt-5.6-sol", messages: [], reasoning_effort: "medium" });
  assert.deepEqual(body.reasoning, { effort: "medium" });
  assert.ok(!("reasoning_effort" in body));
});

test("chat-only knobs are dropped and the request is stateless", () => {
  const body = toResponsesBody({
    model: "gpt-5.5",
    messages: [],
    stream: true,
    stream_options: { include_usage: true },
  });
  assert.ok(!("messages" in body), "messages must not survive alongside input");
  assert.ok(!("stream_options" in body), "stream_options has no Responses analogue");
  assert.equal(body.stream, true);
  // store:false keeps the Engineer stateless — no server-side retention of driver data.
  assert.equal(body.store, false);
});

test("a non-stream response reads back as a chat completion", () => {
  const chat = responsesToChatCompletion({
    output: [
      { type: "reasoning", summary: [] },
      { type: "message", content: [{ type: "output_text", text: "Go softer on the rear bar." }] },
    ],
    usage: { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 800 } },
  });
  const choices = chat.choices as Array<{ message: { content: string | null; tool_calls?: unknown } }>;
  assert.equal(choices[0].message.content, "Go softer on the rear bar.");
  assert.equal(choices[0].message.tool_calls, undefined);
  // Usage must land in the chat field names or addUsage() records nothing and the spend cap
  // silently stops counting the user-facing path.
  assert.deepEqual(chat.usage, {
    prompt_tokens: 1000,
    completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 800 },
  });
});

test("a non-stream tool call reads back as tool_calls", () => {
  const chat = responsesToChatCompletion({
    output: [
      { type: "function_call", call_id: "call_x", name: "kb_search", arguments: '{"query":"roll"}' },
    ],
    usage: { input_tokens: 10, output_tokens: 2 },
  });
  const choices = chat.choices as Array<{ message: { content: string | null; tool_calls?: unknown } }>;
  assert.equal(choices[0].message.content, null);
  assert.deepEqual(choices[0].message.tool_calls, [
    { id: "call_x", type: "function", function: { name: "kb_search", arguments: '{"query":"roll"}' } },
  ]);
});

/** Minimal SSE Response stand-in — the reader only touches `body.getReader()`. */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const text = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  return {
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
        };
      },
    },
  } as unknown as Response;
}

test("streamed text reaches onToken and accumulates", async () => {
  const tokens: string[] = [];
  const result = await readOpenAiResponsesStream(
    sseResponse([
      { type: "response.output_text.delta", delta: "Go softer " },
      { type: "response.output_text.delta", delta: "on the rear bar." },
      {
        type: "response.completed",
        response: { usage: { input_tokens: 900, output_tokens: 12, input_tokens_details: { cached_tokens: 700 } } },
      },
    ]),
    (t) => tokens.push(t)
  );
  assert.equal(result.content, "Go softer on the rear bar.");
  assert.deepEqual(tokens, ["Go softer ", "on the rear bar."]);
  assert.equal(result.toolCalls, null);
  assert.equal(result.usage?.prompt_tokens, 900);
  assert.equal(result.usage?.prompt_tokens_details?.cached_tokens, 700);
});

test("streamed tool calls assemble from argument deltas", async () => {
  const result = await readOpenAiResponsesStream(
    sseResponse([
      {
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "kb_search" },
      },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"que' },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: 'ry":"roll"}' },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    ])
  );
  assert.deepEqual(result.toolCalls, [
    { id: "call_1", type: "function", function: { name: "kb_search", arguments: '{"query":"roll"}' } },
  ]);
});

test("streamed prose is withheld from onToken once a tool call appears", async () => {
  // Same rule the chat reader enforces: text on a tool-calling round is the model reasoning to
  // itself, not an answer. Leaking it would put half-thoughts in the driver's chat window.
  const tokens: string[] = [];
  await readOpenAiResponsesStream(
    sseResponse([
      {
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "kb_search" },
      },
      { type: "response.output_text.delta", delta: "checking..." },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    ]),
    (t) => tokens.push(t)
  );
  assert.deepEqual(tokens, []);
});

test("a tool call announced only at output_item.done is still captured", async () => {
  const result = await readOpenAiResponsesStream(
    sseResponse([
      {
        type: "response.output_item.done",
        item: {
          type: "function_call",
          id: "fc_9",
          call_id: "call_9",
          name: "compare_tires",
          arguments: '{"tire_label_a":"a","tire_label_b":"b"}',
        },
      },
      { type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } },
    ])
  );
  assert.equal(result.toolCalls?.length, 1);
  assert.equal(result.toolCalls?.[0].id, "call_9");
  assert.equal(result.toolCalls?.[0].function.name, "compare_tires");
});
