/**
 * Run: `npx tsx src/lib/engineerPhase5/engineerChatStatus.test.ts`
 *
 * Covers the two pure halves of the Engineer chat loading state: the status label map
 * (real server phases) and the fact rotation (decorative filler).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINEER_CHAT_STATUS_LABELS,
  ENGINEER_CHAT_TOOL_LABELS,
  ENGINEER_CHAT_STATUS_FALLBACK,
  ENGINEER_CHAT_TOOL_FALLBACK,
  engineerChatStatusLabel,
} from "@/lib/engineerPhase5/engineerChatStatus";
import {
  ENGINEER_LOADING_FACTS,
  ENGINEER_FACT_IDLE_MS,
  engineerLoadingFactAt,
  engineerLoadingFactSlot,
} from "@/lib/engineerPhase5/engineerLoadingFacts";

test("every known phase resolves to a non-empty label", () => {
  for (const phase of Object.keys(ENGINEER_CHAT_STATUS_LABELS)) {
    const label = engineerChatStatusLabel(phase);
    assert.equal(label, ENGINEER_CHAT_STATUS_LABELS[phase]);
    assert.ok(label && label.trim().length > 0, `empty label for ${phase}`);
  }
});

test("every known tool resolves through the tool: prefix", () => {
  for (const tool of Object.keys(ENGINEER_CHAT_TOOL_LABELS)) {
    assert.equal(engineerChatStatusLabel(`tool:${tool}`), ENGINEER_CHAT_TOOL_LABELS[tool]);
  }
  assert.equal(
    engineerChatStatusLabel("tool:kb_search"),
    "Checking the vehicle-dynamics reference…"
  );
});

test("every label ends with an ellipsis (voice consistency)", () => {
  for (const label of [
    ...Object.values(ENGINEER_CHAT_STATUS_LABELS),
    ...Object.values(ENGINEER_CHAT_TOOL_LABELS),
    ENGINEER_CHAT_STATUS_FALLBACK,
    ENGINEER_CHAT_TOOL_FALLBACK,
  ]) {
    assert.ok(label.endsWith("…"), `missing ellipsis: ${label}`);
  }
});

test("an unknown tool falls back without leaking the slug", () => {
  const label = engineerChatStatusLabel("tool:some_future_tool");
  assert.equal(label, ENGINEER_CHAT_TOOL_FALLBACK);
  assert.ok(!label.includes("some_future_tool"));
});

test("an unknown phase falls back without leaking the slug", () => {
  const label = engineerChatStatusLabel("quantum_flux");
  assert.equal(label, ENGINEER_CHAT_STATUS_FALLBACK);
  assert.ok(!label.includes("quantum"));
});

test("absent or malformed phases are safe", () => {
  assert.equal(engineerChatStatusLabel(null), null);
  assert.equal(engineerChatStatusLabel(undefined), null);
  assert.equal(engineerChatStatusLabel(""), null);
  assert.equal(engineerChatStatusLabel("   "), null);
  assert.equal(engineerChatStatusLabel("tool:"), ENGINEER_CHAT_TOOL_FALLBACK);
  assert.equal(engineerChatStatusLabel("  thinking  "), ENGINEER_CHAT_STATUS_LABELS.thinking);
});

test("facts are unique, trimmed, single-line and short enough for 390px", () => {
  assert.ok(ENGINEER_LOADING_FACTS.length >= 8);
  assert.equal(new Set(ENGINEER_LOADING_FACTS).size, ENGINEER_LOADING_FACTS.length);
  for (const fact of ENGINEER_LOADING_FACTS) {
    assert.equal(fact, fact.trim());
    assert.ok(fact.length > 0 && fact.length <= 110, `too long: ${fact}`);
    assert.ok(!fact.includes("\n"));
  }
});

test("no fact until the idle window elapses, then one per rotation slot", () => {
  assert.equal(engineerLoadingFactSlot(0), null);
  assert.equal(engineerLoadingFactSlot(5_999), null);
  assert.equal(engineerLoadingFactSlot(ENGINEER_FACT_IDLE_MS), 0);
  assert.equal(engineerLoadingFactSlot(14_999), 0);
  assert.equal(engineerLoadingFactSlot(15_000), 1);
  assert.equal(engineerLoadingFactSlot(24_000), 2);
  assert.equal(engineerLoadingFactSlot(-1), null);
  assert.equal(engineerLoadingFactSlot(Number.NaN), null);
});

test("fact selection stays in range and never repeats back to back", () => {
  for (let seed = 0; seed < 20; seed++) {
    for (let changes = 0; changes < 20; changes++) {
      for (let slot = 0; slot < 20; slot++) {
        const fact = engineerLoadingFactAt(seed, changes, slot);
        assert.ok(ENGINEER_LOADING_FACTS.includes(fact));
        // Next rotation slot, and the next real status, both move to a different fact.
        assert.notEqual(fact, engineerLoadingFactAt(seed, changes, slot + 1));
        assert.notEqual(fact, engineerLoadingFactAt(seed, changes + 1, slot));
      }
    }
  }
});

console.log("engineerChatStatus.test.ts OK");
