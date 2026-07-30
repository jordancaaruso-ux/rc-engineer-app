import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorToRunFocus,
  formatAnchorParam,
  formatGeneralAnchorParam,
  parseAnchorParam,
  parseChatAnchor,
  parseThreadFocusAnchor,
  resolveAnchorRunForRichContext,
  resolveThreadFocusForPersist,
  type EngineerDataAnchor,
} from "./engineerAnchor";

const RUN_A = "clx0run0aaaaaaaaaaaaaaa";
const RUN_B = "clx0run0bbbbbbbbbbbbbbb";
const SETUP_1 = "clx0setup0ccccccccccccc";
const CAR_1 = "clx0car0ddddddddddddddd";

function runAnchor(over: Partial<EngineerDataAnchor> = {}): EngineerDataAnchor {
  return { kind: "run", id: RUN_A, compareRunId: null, setupId: null, pinned: true, ...over };
}

test("parseChatAnchor accepts a valid pinned run anchor", () => {
  assert.deepEqual(
    parseChatAnchor({ kind: "run", id: RUN_A, compareRunId: RUN_B, setupId: SETUP_1, pinned: true }),
    { kind: "run", id: RUN_A, compareRunId: RUN_B, setupId: SETUP_1, pinned: true }
  );
});

test("parseChatAnchor rejects malformed input", () => {
  assert.equal(parseChatAnchor(null), null);
  assert.equal(parseChatAnchor("run:x"), null);
  assert.equal(parseChatAnchor({ kind: "laps", id: RUN_A }), null);
  assert.equal(parseChatAnchor({ kind: "run", id: "short" }), null);
  assert.equal(parseChatAnchor({ kind: "run", id: `${RUN_A}; DROP TABLE` }), null);
});

test("parseChatAnchor strips run-only modifiers from setup/event anchors", () => {
  const setup = parseChatAnchor({ kind: "setup", id: SETUP_1, compareRunId: RUN_B, setupId: SETUP_1, pinned: true });
  assert.deepEqual(setup, { kind: "setup", id: SETUP_1, compareRunId: null, setupId: null, pinned: true });
});

test("parseChatAnchor drops a self-compare", () => {
  const anchor = parseChatAnchor({ kind: "run", id: RUN_A, compareRunId: RUN_A, pinned: true });
  assert.equal(anchor?.kind === "run" ? anchor.compareRunId : "wrong kind", null);
});

test("parseChatAnchor treats anything but pinned:true as Auto", () => {
  assert.equal(parseChatAnchor({ kind: "run", id: RUN_A, pinned: "yes" })?.pinned, false);
  assert.equal(parseChatAnchor({ kind: "run", id: RUN_A })?.pinned, false);
});

test("anchorToRunFocus: run anchor wins over legacy body ids", () => {
  assert.deepEqual(
    anchorToRunFocus(runAnchor({ compareRunId: RUN_B }), { runId: "legacy", compareRunId: "legacy2" }),
    { runId: RUN_A, compareRunId: RUN_B }
  );
});

test("anchorToRunFocus: no anchor falls back to legacy ids", () => {
  assert.deepEqual(anchorToRunFocus(null, { runId: RUN_A, compareRunId: "" }), {
    runId: RUN_A,
    compareRunId: "",
  });
});

test("anchorToRunFocus: setup/event anchors clear the focused pair", () => {
  assert.deepEqual(
    anchorToRunFocus(
      { kind: "setup", id: SETUP_1, compareRunId: null, setupId: null, pinned: true },
      { runId: RUN_A, compareRunId: RUN_B }
    ),
    { runId: "", compareRunId: "" }
  );
});

test("pin URL param round-trips", () => {
  const param = formatAnchorParam("run", RUN_A);
  assert.equal(param, `run:${RUN_A}`);
  assert.deepEqual(parseAnchorParam(param), { kind: "run", id: RUN_A });
  assert.deepEqual(parseAnchorParam(`event:${RUN_B}`), { kind: "event", id: RUN_B });
});

test("parseAnchorParam rejects junk", () => {
  assert.equal(parseAnchorParam(null), null);
  assert.equal(parseAnchorParam(""), null);
  assert.equal(parseAnchorParam("run"), null);
  assert.equal(parseAnchorParam(":abc"), null);
  assert.equal(parseAnchorParam("laps:" + RUN_A), null);
  assert.equal(parseAnchorParam("run:bad id"), null);
});

test("rich-context precedence: focused run > anchor-derived run > latest", () => {
  const base = { anchor: null, focusedRunId: "", anchorDerivedRunId: null, latestRunId: RUN_B };
  assert.equal(resolveAnchorRunForRichContext({ ...base, focusedRunId: RUN_A }), RUN_A);
  assert.equal(
    resolveAnchorRunForRichContext({
      ...base,
      anchor: { kind: "setup", id: SETUP_1, compareRunId: null, setupId: null, pinned: true },
      anchorDerivedRunId: RUN_A,
    }),
    RUN_A
  );
  assert.equal(resolveAnchorRunForRichContext(base), RUN_B);
  assert.equal(resolveAnchorRunForRichContext({ ...base, latestRunId: null }), null);
});

test("rich-context precedence: a run anchor never uses the derived-run slot", () => {
  // focusedRunId is always set for run anchors via anchorToRunFocus; the derived slot
  // must not leak in for kind=run even if a caller passes one.
  assert.equal(
    resolveAnchorRunForRichContext({
      anchor: runAnchor(),
      focusedRunId: "",
      anchorDerivedRunId: RUN_B,
      latestRunId: null,
    }),
    null
  );
});

test("persist focus: a pinned anchor beats the model's resolvedFocus", () => {
  const focus = resolveThreadFocusForPersist({
    anchor: runAnchor({ compareRunId: RUN_B }),
    anchorLabel: "Sat Q2 · X4",
    resolvedFocus: { runId: "model-picked", compareRunId: null },
  });
  assert.equal(focus.primaryRunId, RUN_A);
  assert.equal(focus.compareRunId, RUN_B);
  assert.equal(focus.focusAnchorJson?.pinned, true);
  assert.equal(focus.focusAnchorJson?.label, "Sat Q2 · X4");
});

test("persist focus: a pinned setup anchor clears the run columns", () => {
  const focus = resolveThreadFocusForPersist({
    anchor: { kind: "setup", id: SETUP_1, compareRunId: null, setupId: null, pinned: true },
    resolvedFocus: null,
  });
  assert.equal(focus.primaryRunId, null);
  assert.equal(focus.focusAnchorJson?.kind, "setup");
});

test("persist focus: unpinned keeps today's resolvedFocus-first behaviour", () => {
  const focus = resolveThreadFocusForPersist({
    anchor: runAnchor({ pinned: false }),
    resolvedFocus: { runId: RUN_B, compareRunId: null },
    runId: RUN_A,
  });
  assert.equal(focus.primaryRunId, RUN_B);
  assert.equal(focus.focusAnchorJson?.pinned, false);
  const legacy = resolveThreadFocusForPersist({ anchor: null, resolvedFocus: null, runId: RUN_A });
  assert.equal(legacy.primaryRunId, RUN_A);
  const empty = resolveThreadFocusForPersist({ anchor: null, resolvedFocus: null });
  assert.equal(empty.focusAnchorJson, null);
});

test("parseChatAnchor: general anchor is always a hard subject", () => {
  assert.deepEqual(parseChatAnchor({ kind: "general" }), {
    kind: "general",
    carId: null,
    pinned: true,
  });
  // pinned:false from the wire is overridden — general is a hard subject by definition.
  assert.deepEqual(parseChatAnchor({ kind: "general", carId: CAR_1, pinned: false }), {
    kind: "general",
    carId: CAR_1,
    pinned: true,
  });
  // A malformed carId degrades to pure theory rather than dropping the mode.
  assert.deepEqual(parseChatAnchor({ kind: "general", carId: "junk id" }), {
    kind: "general",
    carId: null,
    pinned: true,
  });
});

test("anchorToRunFocus: a general anchor clears the focused pair despite legacy ids", () => {
  assert.deepEqual(
    anchorToRunFocus(
      { kind: "general", carId: CAR_1, pinned: true },
      { runId: RUN_A, compareRunId: RUN_B }
    ),
    { runId: "", compareRunId: "" }
  );
});

test("general pin URL param round-trips", () => {
  assert.equal(formatGeneralAnchorParam(null), "general");
  assert.equal(formatGeneralAnchorParam(CAR_1), `general:${CAR_1}`);
  assert.deepEqual(parseAnchorParam("general"), { kind: "general", carId: null });
  assert.deepEqual(parseAnchorParam(`general:${CAR_1}`), { kind: "general", carId: CAR_1 });
  assert.deepEqual(parseAnchorParam("general:bad id"), { kind: "general", carId: null });
});

test("rich-context: a general anchor never resolves a run — not even latest", () => {
  assert.equal(
    resolveAnchorRunForRichContext({
      anchor: { kind: "general", carId: null, pinned: true },
      // Defence in depth: even stray focused/derived/latest ids must not win.
      focusedRunId: RUN_A,
      anchorDerivedRunId: RUN_B,
      latestRunId: RUN_B,
    }),
    null
  );
});

test("persist focus: a general anchor keeps the run columns null and round-trips", () => {
  const focus = resolveThreadFocusForPersist({
    anchor: { kind: "general", carId: CAR_1, pinned: true },
    anchorLabel: "General · TC4",
    resolvedFocus: { runId: RUN_A, compareRunId: null },
  });
  assert.equal(focus.primaryRunId, null);
  assert.equal(focus.compareRunId, null);
  assert.deepEqual(focus.focusAnchorJson, {
    kind: "general",
    carId: CAR_1,
    pinned: true,
    version: 1,
    label: "General · TC4",
  });
  const restored = parseThreadFocusAnchor(focus.focusAnchorJson);
  assert.equal(restored?.kind, "general");
  assert.equal(restored?.kind === "general" ? restored.carId : null, CAR_1);
  assert.equal(restored?.label, "General · TC4");
});

test("parseThreadFocusAnchor keeps the frozen label and caps it", () => {
  const parsed = parseThreadFocusAnchor({
    kind: "run",
    id: RUN_A,
    pinned: true,
    label: "x".repeat(300),
  });
  assert.equal(parsed?.version, 1);
  assert.equal(parsed?.label?.length, 160);
  assert.equal(parseThreadFocusAnchor({ label: "no anchor" }), null);
});
