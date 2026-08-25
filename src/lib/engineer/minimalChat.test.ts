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
import {
  ENGINEER_CHAT_SYSTEM_PROMPT,
  ENGINEER_KB_HEADER,
  ENGINEER_PROMPT_LABEL,
  ENGINEER_PROMPT_VERSION,
} from "@/lib/engineer/prompt";

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
  assert.ok(!/tool/i.test(all), "the Engineer sends no tools; instructions about them would be a lie");
});

test("empty and oversized messages are handled before they reach the wire", () => {
  const msgs = buildEngineerMessages(standardEngineerBlocks(KB), [
    { role: "user", content: "   " },
    { role: "user", content: "x".repeat(9000) },
  ]);
  assert.equal(msgs.length, 3, "blank turns are dropped");
  assert.equal(msgs[2].content?.length, 4096, "long turns are capped");
});

test("prompt version fingerprints the prompt text, so a wording change is traceable", () => {
  assert.match(ENGINEER_PROMPT_VERSION, new RegExp(`^${ENGINEER_PROMPT_LABEL}\\+[0-9a-f]{8}$`));
});
