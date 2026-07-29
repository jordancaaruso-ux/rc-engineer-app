import test from "node:test";
import assert from "node:assert/strict";
import {
  anchorToRunFocus,
  formatAnchorParam,
  parseAnchorParam,
  parseChatAnchor,
  parseThreadFocusAnchor,
  resolveAnchorRunForRichContext,
  resolveThreadFocusForPersist,
  type EngineerChatAnchor,
} from "./engineerAnchor";

const RUN_A = "clx0run0aaaaaaaaaaaaaaa";
const RUN_B = "clx0run0bbbbbbbbbbbbbbb";
const SETUP_1 = "clx0setup0ccccccccccccc";

function runAnchor(over: Partial<EngineerChatAnchor> = {}): EngineerChatAnchor {
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
  assert.equal(anchor?.compareRunId, null);
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
