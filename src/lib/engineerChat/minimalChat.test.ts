/**
 * Run: `node --conditions=react-server --import tsx src/lib/engineerChat/minimalChat.test.ts`
 * (react-server condition needed — the module chain imports "server-only".)
 *
 * This suite exists to keep v0 v0. The old pipeline grew to ~99K chars a turn one reasonable-
 * looking addition at a time, and nothing ever failed when a block was added. These assertions
 * fail.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEngineerChatMessages } from "@/lib/engineerChat/runChatTurn";
import {
  ENGINEER_CHAT_SYSTEM_PROMPT,
  ENGINEER_KB_HEADER,
  ENGINEER_PROMPT_VERSION,
} from "@/lib/engineerChat/prompt";

const KB = "=== vehicle-dynamics/springs.md ===\n\nStiffer springs move load faster.";

test("the request is exactly KB, prompt, conversation — nothing else", () => {
  const msgs = buildEngineerChatMessages(KB, [
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
  const a = buildEngineerChatMessages(KB, [{ role: "user", content: "first question" }]);
  const b = buildEngineerChatMessages(KB, [{ role: "user", content: "a totally different one" }]);
  assert.equal(a[0].content, b[0].content, "KB prefix must not vary between turns");
  assert.equal(a[1].content, b[1].content, "prompt must not vary between turns");
});

test("no per-car data can reach the model — the prompt says so out loud", () => {
  const all = ENGINEER_KB_HEADER + ENGINEER_CHAT_SYSTEM_PROMPT;
  assert.ok(
    /cannot see this driver's logged data/i.test(ENGINEER_CHAT_SYSTEM_PROMPT),
    "v0 has no setup or run data; the model must be told, or it invents values"
  );
  assert.ok(!/context json/i.test(all), "there is no context JSON to point the model at");
  assert.ok(!/tool/i.test(all), "v0 sends no tools; instructions about them would be a lie");
});

test("empty and oversized messages are handled before they reach the wire", () => {
  const msgs = buildEngineerChatMessages(KB, [
    { role: "user", content: "   " },
    { role: "user", content: "x".repeat(9000) },
  ]);
  assert.equal(msgs.length, 3, "blank turns are dropped");
  assert.equal(msgs[2].content?.length, 4096, "long turns are capped");
});

test("prompt version fingerprints the prompt text, so a wording change is traceable", () => {
  assert.match(ENGINEER_PROMPT_VERSION, /^2026-08-05-minimal\+[0-9a-f]{8}$/);
});
