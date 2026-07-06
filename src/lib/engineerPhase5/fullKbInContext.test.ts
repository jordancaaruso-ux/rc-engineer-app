/**
 * Run: `node --conditions=react-server --import tsx src/lib/engineerPhase5/fullKbInContext.test.ts`
 * (react-server condition needed — the module chain imports "server-only".)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildFullKbSystemBlock,
  fullKbInContextEnabled,
  FULL_KB_POINTER_SNIPPET,
  replaceRetrievedKbWithFullKbPointer,
} from "@/lib/engineerPhase5/fullKbInContext";
import { loadFullVehicleDynamicsKb } from "@/lib/engineerPhase5/vehicleDynamicsKb";

test("loadFullVehicleDynamicsKb concatenates every KB file except README, sorted", async () => {
  const kb = await loadFullVehicleDynamicsKb();
  assert.ok(kb.files.length >= 5, `expected several KB files, got ${kb.files.length}`);
  assert.ok(!kb.files.some((f) => f.toLowerCase() === "readme.md"));
  const sorted = [...kb.files].sort();
  assert.deepEqual(kb.files, sorted, "files must be sorted for a byte-stable cache prefix");
  for (const f of kb.files) {
    assert.ok(
      kb.markdown.includes(`=== vehicle-dynamics/${f} ===`),
      `missing separator for ${f}`
    );
  }
  assert.equal(kb.totalChars, kb.markdown.length);
  // Repeat load returns the identical cached string (stable prompt-cache prefix).
  const again = await loadFullVehicleDynamicsKb();
  assert.equal(again.markdown, kb.markdown);
});

test("buildFullKbSystemBlock ships full prose under the ceiling", async () => {
  assert.equal(fullKbInContextEnabled(), true, "default must be enabled");
  const block = await buildFullKbSystemBlock();
  assert.ok(block, "block should build for the current KB size");
  assert.match(block!.content, /VEHICLE DYNAMICS KB — FULL TEXT/);
  assert.match(block!.content, /=== vehicle-dynamics\//);
  // Full prose, not excerpts: a known deep-in-file KB line must be present verbatim.
  const kb = await loadFullVehicleDynamicsKb();
  assert.ok(block!.content.includes(kb.markdown), "block must embed the whole corpus");
});

test("ENGINEER_FULL_KB_IN_CONTEXT=0 disables the block", async () => {
  process.env.ENGINEER_FULL_KB_IN_CONTEXT = "0";
  try {
    assert.equal(fullKbInContextEnabled(), false);
    assert.equal(await buildFullKbSystemBlock(), null);
  } finally {
    delete process.env.ENGINEER_FULL_KB_IN_CONTEXT;
  }
});

test("replaceRetrievedKbWithFullKbPointer swaps both excerpt arrays without mutating", () => {
  const snippets = [{ title: "t", excerpt: "e", sourcePath: "vehicle-dynamics/damper-oil.md" }];
  const ctx = {
    contextTier: "full",
    richEngineerContext: { anchorRunId: "r1", vehicleDynamicsKb: snippets },
    focusedRunPair: { primaryRunId: "r1", setupCompareKbSnippets: snippets },
    engineeringBrain: { version: 1 },
  };
  const out = replaceRetrievedKbWithFullKbPointer(ctx) as typeof ctx;
  assert.deepEqual(out.richEngineerContext.vehicleDynamicsKb, [FULL_KB_POINTER_SNIPPET]);
  assert.deepEqual(out.focusedRunPair.setupCompareKbSnippets, [FULL_KB_POINTER_SNIPPET]);
  // Original context keeps the real snippets (fallback + persisted contextJson rely on it).
  assert.equal(ctx.richEngineerContext.vehicleDynamicsKb, snippets);
  assert.equal(ctx.focusedRunPair.setupCompareKbSnippets, snippets);
  // Untouched branches pass through by reference.
  assert.equal(out.engineeringBrain, ctx.engineeringBrain);
});

test("replaceRetrievedKbWithFullKbPointer tolerates missing branches", () => {
  assert.equal(replaceRetrievedKbWithFullKbPointer(null), null);
  const bare = { contextTier: "full", richEngineerContext: null, focusedRunPair: null };
  assert.deepEqual(replaceRetrievedKbWithFullKbPointer(bare), bare);
});
