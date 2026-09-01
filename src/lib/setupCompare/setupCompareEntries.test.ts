import test from "node:test";
import assert from "node:assert/strict";
import { fetchSetupCompareEntries } from "./setupCompareEntries";

/**
 * The compare pool, pinned.
 *
 * Two things here are load-bearing beyond this module and neither is visible from a screenshot.
 *
 * THE ID VOCABULARY. `/setup/comparison?a=run-…&b=saved-…` carries these exact strings, minted here
 * and nowhere else, so the Tools page can hand over a filled-in pair. Rename a prefix and those
 * links stop resolving — silently, into an empty slot, which is the page's normal starting state.
 *
 * WHAT GETS DROPPED. A comparison is two setups in the same boxes on one page picture. A row with
 * no sheet has no paper, and an empty one flips to a blank sheet that reads as "they run nothing
 * there". Both are dropped before the driver ever sees a list — a rule with no UI to check it by.
 */

type Fetched = { url: string };

function stubPools(pools: {
  runs?: unknown;
  team?: unknown;
  library?: unknown;
  /** URLs that should answer as a failed read rather than a body. */
  fail?: string[];
}): { calls: Fetched[]; restore: () => void } {
  const calls: Fetched[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push({ url });
    if (pools.fail?.some((f) => url.includes(f))) {
      return { ok: false, json: async () => null } as Response;
    }
    // Order matters: every pool's path ends in "for-picker", so match the specific ones first.
    const body = url.includes("teammate-for-picker")
      ? pools.team
      : url.includes("library-for-picker")
        ? pools.library
        : pools.runs;
    return { ok: true, json: async () => body ?? {} } as Response;
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const CAR = { name: "A800RR", setupSheetTemplate: "a800rr", setupSheetModelId: "model-1" };

function run(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: "2026-08-30T02:00:00.000Z",
    sessionType: "TESTING",
    tireRunNumber: 1,
    car: CAR,
    setupSnapshot: { id: `snap-${id}`, data: { frontCamber: -1.5 } },
    ...over,
  };
}

test("mints one id per pool, and they are the ones the comparison page reads", async () => {
  const stub = stubPools({
    runs: { runs: [run("r1")] },
    team: { runs: [{ ...run("r2"), userId: "u9" }], memberDisplayByUserId: { u9: "Dayne" } },
    library: {
      setups: [
        {
          id: "lib1",
          name: "Arena high grip",
          carName: "A800RR",
          setupSheetModelId: "model-1",
          setupSheetTemplate: "a800rr",
          setupData: { frontCamber: -2 },
        },
      ],
    },
  });
  try {
    const { entries, error } = await fetchSetupCompareEntries();
    assert.equal(error, null);
    assert.deepEqual(
      entries?.map((e) => e.id),
      ["run-r1", "team-r2", "saved-lib1"]
    );
    assert.deepEqual(
      entries?.map((e) => e.source),
      ["mine", "teammates", "setups"]
    );
    // A teammate's row has to name them, or two identical sessions are indistinguishable.
    assert.match(entries![1]!.title, /Dayne/);
  } finally {
    stub.restore();
  }
});

test("a setup with no sheet, or no values, is not offered", async () => {
  const stub = stubPools({
    runs: {
      runs: [
        run("noSheet", { car: { ...CAR, setupSheetModelId: null } }),
        run("empty", { setupSnapshot: { id: "s", data: { frontCamber: null, rearToe: "" } } }),
        run("noSnapshot", { setupSnapshot: null }),
        run("keeper"),
      ],
    },
    library: {
      setups: [
        { id: "libNoSheet", setupSheetModelId: null, setupData: { frontCamber: -2 } },
        { id: "libEmpty", setupSheetModelId: "model-1", setupData: {} },
      ],
    },
  });
  try {
    const { entries } = await fetchSetupCompareEntries();
    assert.deepEqual(
      entries?.map((e) => e.id),
      ["run-keeper"]
    );
  } finally {
    stub.restore();
  }
});

test("one dead pool is survivable and silent; all three dead is an error, not an empty list", async () => {
  const partial = stubPools({
    runs: { runs: [run("r1")] },
    fail: ["teammate-for-picker", "library-for-picker"],
  });
  try {
    const { entries, error } = await fetchSetupCompareEntries();
    assert.equal(error, null);
    assert.deepEqual(
      entries?.map((e) => e.id),
      ["run-r1"]
    );
  } finally {
    partial.restore();
  }

  const dead = stubPools({ fail: ["/api/"] });
  try {
    const { entries, error } = await fetchSetupCompareEntries();
    // Null, not `[]`: the caller keeps the list it already had rather than blanking a usable one.
    assert.equal(entries, null);
    assert.match(error ?? "", /signed in/);
  } finally {
    dead.restore();
  }
});
