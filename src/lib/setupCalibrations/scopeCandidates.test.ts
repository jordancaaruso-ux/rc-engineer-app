import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isCandidateInScopeForModel,
  scopeCandidatesForModel,
  type ScopeCandidate,
} from "@/lib/setupCalibrations/scopeCandidates";

const cand = (over: Partial<ScopeCandidate> & { id?: string }): ScopeCandidate & { id: string } => ({
  id: over.id ?? "c",
  setupSheetModelId: over.setupSheetModelId ?? null,
  setupSheetModelName: over.setupSheetModelName ?? null,
});

test("calibration linked to the exact model id is in scope", () => {
  const c = cand({ setupSheetModelId: "m1", setupSheetModelName: "Mugen MTC3" });
  assert.equal(isCandidateInScopeForModel(c, "m1", "Mugen MTC3"), true);
});

test("unlinked (generic) calibration is in scope for any chassis", () => {
  const c = cand({ setupSheetModelId: null, setupSheetModelName: null });
  assert.equal(isCandidateInScopeForModel(c, "m1", "Mugen MTC3"), true);
  assert.equal(isCandidateInScopeForModel(c, "m2", "Xray T4"), true);
});

test("duplicate model row with same normalized name is in scope (the Mugen fix)", () => {
  // A second "Mugen MTC3" row (different id, messy casing/spacing) created by a
  // repeat wizard run must still match when uploading for the canonical model.
  const c = cand({ setupSheetModelId: "m2", setupSheetModelName: "mugen  MTC3" });
  assert.equal(isCandidateInScopeForModel(c, "m1", "Mugen MTC3"), true);
});

test("calibration linked to a genuinely different chassis is out of scope", () => {
  const c = cand({ setupSheetModelId: "x1", setupSheetModelName: "Xray T4" });
  assert.equal(isCandidateInScopeForModel(c, "m1", "Mugen MTC3"), false);
});

test("different-name model is out of scope even without a target name", () => {
  // No target model name supplied: only exact-id and unlinked candidates qualify.
  const c = cand({ setupSheetModelId: "x1", setupSheetModelName: "Xray T4" });
  assert.equal(isCandidateInScopeForModel(c, "m1", null), false);
});

test("scopeCandidatesForModel keeps exact, unlinked, and same-name; drops others", () => {
  const candidates = [
    cand({ id: "exact", setupSheetModelId: "m1", setupSheetModelName: "Mugen MTC3" }),
    cand({ id: "generic", setupSheetModelId: null, setupSheetModelName: null }),
    cand({ id: "dupe", setupSheetModelId: "m2", setupSheetModelName: "MUGEN mtc3" }),
    cand({ id: "other", setupSheetModelId: "x1", setupSheetModelName: "Xray T4" }),
  ];
  const kept = scopeCandidatesForModel(candidates, "m1", "Mugen MTC3").map((c) => c.id);
  assert.deepEqual(kept.sort(), ["dupe", "exact", "generic"]);
});
