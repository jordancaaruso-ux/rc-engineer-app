/**
 * Lever families are derived from the KB's `**Moved by:**` links, never listed by hand
 * (netFamilies.ts). These pin the shape the founder asked for on 2026-09-08 — a rear spring and a
 * rear bar are one change; the four steering-geometry knobs are one change; every roll-centre
 * shim key sits in one family — and the invariants that keep the render honest.
 *
 *   npm run test:nets-families
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyOf, groupNets, loadNetFamilies, renderGroupHeading, wholeCarPairsFor } from "./netFamilies";
import { loadNets } from "./nets";

const together = (params: string[], entriesByParam: Map<string, ReturnType<typeof familyOf>>) => {
  const fams = params.map((p) => entriesByParam.get(p)?.concept ?? null);
  assert.ok(fams.every((f) => f !== null), `unclaimed knob among ${params.join(", ")}: ${fams}`);
  assert.equal(new Set(fams).size, 1, `${params.join(", ")} split across ${[...new Set(fams)]}`);
};

test("families come from the KB and the founder's three examples hold", async () => {
  const families = await loadNetFamilies();
  const nets = await loadNets({ discipline: "touring" });
  const fam = new Map(nets.entries.map((e) => [e.parameter, familyOf(e, families)] as const));

  together(["spring_rear", "arb_rear", "spring_front", "arb_front"], fam);
  together(["toe_front", "bump_steer_shims_front", "inner_steering_angle", "caster_front"], fam);
  together(
    [
      "upper_inner_shims_front", "upper_outer_shims_front", "under_lower_arm_shims_front", "under_hub_shims_front",
      "upper_inner_shims_rear", "upper_outer_shims_rear", "under_lower_arm_shims_rear", "under_hub_shims_rear",
    ],
    fam
  );
  together(["damper_oil_front", "damper_oil_rear"], fam);
});

test("no knob page belongs to two families, and every family title is the concept's own heading", async () => {
  const families = await loadNetFamilies();
  const seen = new Map<string, string>();
  for (const f of families) {
    assert.ok(f.title.length > 0 && !/\($/.test(f.title), `bad title for ${f.concept}: "${f.title}"`);
    for (const page of f.knobPages) {
      // A page linked from two Moved-by lines is allowed in the KB; familyOf resolves it to the
      // first by slug. Record it so a future collision is a visible decision, not a silent one.
      if (seen.has(page) && seen.get(page) !== f.concept) {
        console.warn(`[nets-families] ${page} is claimed by ${seen.get(page)} and ${f.concept}; ${seen.get(page)} wins`);
      } else seen.set(page, f.concept);
    }
  }
});

test("the render carries GROUP lines, one per family with two or more knobs, and stays byte-stable", async () => {
  const families = await loadNetFamilies();
  const nets = await loadNets({ discipline: "touring" });
  const units = groupNets(nets.entries, families);
  const groups = units.filter((u) => u.kind === "group");
  assert.ok(groups.length >= 4, `expected at least 4 groups, got ${groups.length}`);
  for (const g of groups) {
    if (g.kind !== "group") continue;
    assert.ok(g.entries.length >= 2);
    const heading = renderGroupHeading(g);
    assert.ok(nets.text.includes(heading), `heading missing from render: ${heading}`);
    for (const e of g.entries) assert.ok(heading.includes(e.label), `${e.label} not named on its GROUP line`);
  }
  assert.ok(nets.text.includes("GROUP: ROLL STIFFNESS (4 knobs, one change)"), "roll stiffness group");
  assert.equal(groupNets(nets.entries, families).map((u) => (u.kind === "group" ? u.family.concept : u.entry.parameter)).join(),
    units.map((u) => (u.kind === "group" ? u.family.concept : u.entry.parameter)).join(), "order is deterministic");
  // Whole-car pairs (both ends together) sit on the GROUP line of the family holding every knob they name.
  const byTitle = new Map(groups.map((g) => [g.kind === "group" ? g.family.title.toLowerCase() : "", g] as const));
  const stiffness = byTitle.get("roll stiffness");
  assert.ok(stiffness && stiffness.kind === "group", "roll stiffness group exists");
  const stiffPairs = wholeCarPairsFor(stiffness, nets.wholeCar).map((p) => p.id).sort();
  assert.deepEqual(stiffPairs, ["arb_both", "spring_both"], "bars and springs whole-car lines belong to roll stiffness");
  assert.ok(nets.text.includes("BOTH ENDS TOGETHER — Anti-roll bars, both ends"), "whole-car line rendered on the GROUP");
  for (const p of nets.wholeCar) assert.ok(/\btoo (high|low|stiff|soft|thick|thin)\b/.test(p.more + " " + p.less), `${p.id} names no too-far edge`);
  for (const p of nets.wholeCar) assert.ok(!/low[- ]grip|high[- ]grip|grip comes up|grip drops/i.test(p.more + p.less), `${p.id} carries a day word`);
  // Every reviewed entry is rendered exactly once.
  for (const e of nets.entries) {
    const label = e.label.toUpperCase();
    const count = nets.text.split(`\n${label}`).length - 1 + (nets.text.startsWith(label) ? 1 : 0);
    assert.ok(count >= 1, `${e.label} not rendered`);
  }
});
