/**
 * Run: `node --conditions=react-server --import tsx src/lib/engineerChat/lab/engineerLab.test.ts`
 *
 * The lab's whole promise is that it changes nothing for anyone else and that its answers never
 * pollute the shipped Engineer's rating baseline. Both are easy to break silently, so both are
 * asserted here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildEngineerChatMessages } from "@/lib/engineerChat/runChatTurn";
import {
  ENGINEER_CHAT_SYSTEM_PROMPT,
  ENGINEER_CHAT_SYSTEM_PROMPT_WITH_FACTS,
  ENGINEER_PROMPT_VERSION,
  engineerLabPromptVersion,
} from "@/lib/engineerChat/prompt";
import { canUseEngineerLab, ENGINEER_LAB_RUNGS } from "@/lib/engineerChat/lab/labFlags";

const KB = "=== vehicle-dynamics/springs.md ===\n\nStiffer springs move load faster.";
const HISTORY = [{ role: "user" as const, content: "why does it push?" }];

test("no fact blocks means the shipped request, unchanged", () => {
  const shipped = buildEngineerChatMessages(KB, HISTORY);
  const emptyLab = buildEngineerChatMessages(KB, HISTORY, []);
  const blankLab = buildEngineerChatMessages(KB, HISTORY, ["", "   "]);
  assert.deepEqual(emptyLab, shipped);
  assert.deepEqual(blankLab, shipped);
  assert.equal(shipped.length, 3);
  assert.equal(shipped[1].content, ENGINEER_CHAT_SYSTEM_PROMPT);
});

test("fact blocks go after the KB and the prompt, so the cached prefix survives", () => {
  const msgs = buildEngineerChatMessages(KB, HISTORY, ["SETUP ON THE CAR.\nfront camber: -1.5"]);
  assert.equal(msgs.length, 4);
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["system", "system", "system", "user"]
  );
  const shipped = buildEngineerChatMessages(KB, HISTORY);
  assert.equal(msgs[0].content, shipped[0].content, "KB prefix must be identical to the shipped one");
  assert.match(String(msgs[2].content), /front camber/);
});

test("with facts attached the prompt stops claiming it cannot see the driver's data", () => {
  const withFacts = buildEngineerChatMessages(KB, HISTORY, ["SETUP ON THE CAR.\nx: 1"]);
  assert.equal(withFacts[1].content, ENGINEER_CHAT_SYSTEM_PROMPT_WITH_FACTS);
  assert.ok(
    /cannot see this driver's logged data/i.test(ENGINEER_CHAT_SYSTEM_PROMPT),
    "shipped prompt still says it is blind"
  );
  assert.ok(
    !/cannot see this driver's logged data/i.test(ENGINEER_CHAT_SYSTEM_PROMPT_WITH_FACTS),
    "handing over a setup sheet while saying you cannot see it teaches the model to distrust it"
  );
});

test("lab answers are stamped a different prompt version from the shipped baseline", () => {
  const shipped = engineerLabPromptVersion([]);
  const lab = engineerLabPromptVersion(["setupSheet", "sessionFacts"]);
  assert.equal(shipped, ENGINEER_PROMPT_VERSION, "no rungs = the shipped batch");
  assert.notEqual(lab, ENGINEER_PROMPT_VERSION);
  assert.match(lab, /^2026-08-05-lab-setupSheet\+sessionFacts\+[0-9a-f]{8}$/);
});

test("each rung combination gets its own version, so batches stay separable", () => {
  const seen = new Set(
    [
      [],
      ["setupSheet"],
      ["sessionFacts"],
      ["comparableRuns"],
      ["setupSheet", "sessionFacts"],
      ["setupSheet", "sessionFacts", "comparableRuns"],
    ].map((r) => engineerLabPromptVersion(r))
  );
  assert.equal(seen.size, 6, "two rung sets sharing a version would merge two experiments");
});

test("the gate is the admin email list, and a non-admin is never eligible", () => {
  const prev = process.env.AUTH_ADMIN_EMAILS;
  try {
    process.env.AUTH_ADMIN_EMAILS = "founder@example.com";
    assert.equal(canUseEngineerLab("founder@example.com"), true);
    assert.equal(canUseEngineerLab("FOUNDER@example.com"), true, "case-insensitive");
    assert.equal(canUseEngineerLab("someone.else@example.com"), false);
    assert.equal(canUseEngineerLab(null), false);
    assert.equal(canUseEngineerLab(""), false);
    process.env.AUTH_ADMIN_EMAILS = "";
    assert.equal(canUseEngineerLab("founder@example.com"), false, "unset admin list locks it shut");
  } finally {
    if (prev === undefined) delete process.env.AUTH_ADMIN_EMAILS;
    else process.env.AUTH_ADMIN_EMAILS = prev;
  }
});

test("every rung has a distinct settings key so one switch cannot flip another", () => {
  const keys = new Set(ENGINEER_LAB_RUNGS.map((r) => r.settingKey));
  const ids = new Set(ENGINEER_LAB_RUNGS.map((r) => r.id));
  assert.equal(keys.size, ENGINEER_LAB_RUNGS.length);
  assert.equal(ids.size, ENGINEER_LAB_RUNGS.length);
});
