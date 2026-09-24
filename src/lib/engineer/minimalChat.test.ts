/**
 * Run: `node --conditions=react-server --import tsx src/lib/engineer/minimalChat.test.ts`
 * (react-server condition needed — the module chain imports "server-only".)
 *
 * This suite exists to keep the payload honest. The pre-rebuild pipeline grew to ~99K chars
 * a turn one reasonable-looking addition at a time, and nothing ever failed when a block
 * was added. These assertions fail.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEngineerMessages,
  standardEngineerBlocks,
  type EngineerPayloadBlock,
} from "@/lib/engineer/payload";
import { buildChatCompletionBody, ENGINEER_REASONING_EFFORT_DEFAULT } from "@/lib/engineer/openai";
import {
  ENGINEER_CHAT_SYSTEM_PROMPT,
  ENGINEER_KB_HEADER,
  ENGINEER_PROMPT_LABEL,
  ENGINEER_PROMPT_VERSION,
} from "@/lib/engineer/prompt";
import { ENGINEER_IMPERIAL_UNITS_TEXT, engineerUnitsBlocks } from "@/lib/engineer/unitsBlock";

const KB = "=== vehicle-dynamics/springs.md ===\n\nStiffer springs move load faster.";

test("the shipped request is exactly KB, prompt, conversation — nothing else", () => {
  const msgs = buildEngineerMessages(standardEngineerBlocks(KB), [
    { role: "user", content: "why does it push on entry?" },
    { role: "assistant", content: "because..." },
    { role: "user", content: "and mid corner?" },
  ]);

  assert.equal(msgs.length, 5, "two system messages and three turns, no more");
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["system", "system", "user", "assistant", "user"]
  );
  assert.equal(msgs[0].content, ENGINEER_KB_HEADER + KB);
  assert.equal(msgs[1].content, ENGINEER_CHAT_SYSTEM_PROMPT);
});

test("the KB is the first message and byte-stable — the prompt cache depends on it", () => {
  const a = buildEngineerMessages(standardEngineerBlocks(KB), [
    { role: "user", content: "first question" },
  ]);
  const b = buildEngineerMessages(standardEngineerBlocks(KB), [
    { role: "user", content: "a totally different one" },
  ]);
  assert.equal(a[0].content, b[0].content, "KB prefix must not vary between turns");
  assert.equal(a[1].content, b[1].content, "prompt must not vary between turns");
});

test("a cache-stable block placed after a per-turn block throws — mis-ordering must fail loudly", () => {
  const blocks: EngineerPayloadBlock[] = [
    { id: "kb", cacheStable: true, content: "kb" },
    { id: "session-facts", cacheStable: false, content: "today's grip is low" },
    { id: "prompt", cacheStable: true, content: "prompt" },
  ];
  assert.throws(
    () => buildEngineerMessages(blocks, [{ role: "user", content: "q" }]),
    /un-caches the prefix/
  );
});

test("per-turn blocks are allowed after the stable prefix — the driver-data slot works", () => {
  const blocks: EngineerPayloadBlock[] = [
    { id: "kb", cacheStable: true, content: "kb" },
    { id: "prompt", cacheStable: true, content: "prompt" },
    { id: "session-facts", cacheStable: false, content: "today's grip is low" },
  ];
  const msgs = buildEngineerMessages(blocks, [{ role: "user", content: "q" }]);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["system", "system", "system", "user"]
  );
  assert.equal(msgs[2].content, "today's grip is low");
});

test("the prompt draws the data line exactly where the payload does", () => {
  const all = ENGINEER_KB_HEADER + ENGINEER_CHAT_SYSTEM_PROMPT;
  assert.ok(
    /DRIVER DATA block/.test(ENGINEER_CHAT_SYSTEM_PROMPT),
    "driver data ships as a named block; the prompt must name it or the model invents values around it"
  );
  assert.ok(
    /can't see|cannot see/i.test(ENGINEER_CHAT_SYSTEM_PROMPT),
    "the prompt must still tell the model to say when data is beyond what is attached"
  );
  assert.ok(!/context json/i.test(all), "there is no context JSON to point the model at");
  // The one tool (livercPracticeTool.ts, since 2026-09-22) describes itself on the wire in its own
  // definition; prompt words about it would drift from that definition, and General sends none.
  assert.ok(!/tool/i.test(all), "the prompt says nothing about tools: the tool's definition is its only description");
});

test("empty and oversized messages are handled before they reach the wire", () => {
  const msgs = buildEngineerMessages(standardEngineerBlocks(KB), [
    { role: "user", content: "   " },
    { role: "user", content: "x".repeat(9000) },
  ]);
  assert.equal(msgs.length, 3, "blank turns are dropped");
  assert.equal(msgs[2].content?.length, 4096, "long turns are capped");
});

test("GPT-5 and later get the effort and never a temperature; older models the reverse", () => {
  const saved = process.env.ENGINEER_REASONING_EFFORT;
  process.env.ENGINEER_REASONING_EFFORT = "medium";
  try {
    for (const model of ["gpt-5.6-terra", "gpt-6-sol", "gpt-6-sol-2026-09-22"]) {
      const body = buildChatCompletionBody(model, 0.3, { messages: [] });
      assert.equal(body.temperature, undefined, `${model} refuses a custom temperature`);
      assert.equal(body.reasoning_effort, "medium", `${model} takes the effort knob`);
    }
    const old = buildChatCompletionBody("gpt-4o", 0.3, { messages: [] });
    assert.equal(old.temperature, 0.3);
    assert.equal(old.reasoning_effort, undefined);

    // Unset (production) and junk both send the stated default, never the model's own default.
    for (const env of [undefined, "hgih"]) {
      if (env === undefined) delete process.env.ENGINEER_REASONING_EFFORT;
      else process.env.ENGINEER_REASONING_EFFORT = env;
      const body = buildChatCompletionBody("gpt-6-sol", 0.3, { messages: [] });
      assert.equal(body.reasoning_effort, ENGINEER_REASONING_EFFORT_DEFAULT);
    }
  } finally {
    if (saved === undefined) delete process.env.ENGINEER_REASONING_EFFORT;
    else process.env.ENGINEER_REASONING_EFFORT = saved;
  }
});

test("units: a metric driver's request is unchanged; a °F driver's carries one stable block after the prompt", () => {
  const driverData: EngineerPayloadBlock = { id: "driver-data", cacheStable: false, content: "air temp °C: 30" };
  const q = [{ role: "user" as const, content: "q" }];

  assert.deepEqual(engineerUnitsBlocks("metric"), []);
  const before = buildEngineerMessages([...standardEngineerBlocks(KB), driverData], q);
  const metric = buildEngineerMessages(
    [...standardEngineerBlocks(KB), ...engineerUnitsBlocks("metric"), driverData],
    q
  );
  assert.deepEqual(metric, before, "metric adds nothing");

  const imperial = buildEngineerMessages(
    [...standardEngineerBlocks(KB), ...engineerUnitsBlocks("imperial"), driverData],
    q
  );
  assert.equal(imperial.length, before.length + 1);
  assert.equal(imperial[2].content, ENGINEER_IMPERIAL_UNITS_TEXT, "straight after the prompt");
  assert.equal(imperial[3].content, "air temp °C: 30", "the driver data stays metric");
  assert.equal(engineerUnitsBlocks("imperial")[0].cacheStable, true);
});

test("prompt version fingerprints the prompt text, so a wording change is traceable", () => {
  assert.match(ENGINEER_PROMPT_VERSION, new RegExp(`^${ENGINEER_PROMPT_LABEL}\\+[0-9a-f]{8}$`));
});
