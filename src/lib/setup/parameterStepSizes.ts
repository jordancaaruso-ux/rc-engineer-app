/**
 * One "average adjustment step" per universal setup parameter — the size of a normal move a driver
 * would actually make on that knob.
 *
 * Used to give a single base setup a *width*. A base setup is one point: it says where the middle is
 * but not how far out is far. `synthesizeBaseSetupStats` turns (base value, step) into a window so
 * the Engineer can tell "already on the softest spring" apart from "on the stiffest", which is what
 * decides whether a suggestion is pushing further out of the window or back into it.
 *
 * ⚠️ FOUNDER-OWNED NUMBERS. These are proposals awaiting Jordan's sign-off, not measured values.
 * Editing a number here changes Engineer behaviour and needs no code change.
 *
 * NOT the same table as `src/lib/setupAggregations/trendMinimumDeltas.ts`, and deliberately not
 * imported from it. That one answers "is a shift between two grip buckets big enough to call a
 * trend?" — a statistical gate tuned against community spread. This one answers "how big is one
 * human adjustment?" The numbers look similar and mean different things; keep them apart so tuning
 * one never silently bends the other.
 *
 * `null` means unknown or not meaningfully stepped (categorical rows like `chassis`, part-choice rows
 * like `c45_installed_front`). A null step yields no bands at all — never guess a width.
 */

/** Ordered: first match wins, so more specific prefixes must come before broader ones. */
const STEP_RULES: ReadonlyArray<{ test: (k: string) => boolean; step: number | null }> = [
  // ── Shim stacks: one physical shim. ────────────────────────────────────────────────────────────
  { test: (k) => k.includes("shims"), step: 0.25 },

  // ── Derived geometry (computed, not adjusted directly). One 0.25 mm shim moves RC ~0.4–0.55 mm. ─
  { test: (k) => k.startsWith("derived_") && k.endsWith("_deg"), step: 0.5 },
  { test: (k) => k.startsWith("derived_"), step: 0.5 },

  // ── Angles. ────────────────────────────────────────────────────────────────────────────────────
  { test: (k) => k.startsWith("camber_"), step: 0.25 },
  { test: (k) => k.startsWith("caster_"), step: 0.5 },
  { test: (k) => k.startsWith("toe_"), step: 0.25 },
  { test: (k) => k === "inner_steering_angle", step: 1 },

  // ── Heights and travel (mm). ───────────────────────────────────────────────────────────────────
  { test: (k) => k.startsWith("ride_height_"), step: 0.5 },
  { test: (k) => k.startsWith("droop_"), step: 0.5 },
  { test: (k) => k.startsWith("downstop_"), step: 0.5 },
  { test: (k) => k.startsWith("upstop_"), step: 0.5 },
  { test: (k) => k.startsWith("diff_height_"), step: 0.5 },

  // ── Roll bars: one wire diameter step. ─────────────────────────────────────────────────────────
  { test: (k) => k.startsWith("arb_"), step: 0.1 },
  { test: (k) => k === "rear_hrb_setting", step: 1 },

  // ── Dampers. ───────────────────────────────────────────────────────────────────────────────────
  { test: (k) => k.startsWith("damper_oil_"), step: 50 },
  { test: (k) => k.startsWith("damper_percent_"), step: 2.5 },
  { test: (k) => k.startsWith("pss_percent_setup_"), step: 2.5 },
  // `damping_*` semantics vary by sheet — no safe universal step until we know what it holds.
  { test: (k) => k.startsWith("damping_"), step: null },

  // ── Springs. `spring_gap_*` is mm; bare `spring_*` is a spring NAME, not a number. ──────────────
  { test: (k) => k.startsWith("spring_gap_"), step: 0.4 },
  { test: (k) => k === "front_spring_rate_gf_mm" || k === "rear_spring_rate_gf_mm", step: 5 },
  { test: (k) => k.startsWith("spring_"), step: null },

  // ── Fluids: one full grade. ────────────────────────────────────────────────────────────────────
  { test: (k) => k === "diff_oil", step: 1000 },

  // ── Mass and layout. ───────────────────────────────────────────────────────────────────────────
  { test: (k) => k === "weight_balance_front_percent", step: 0.5 },
  { test: (k) => k === "motor_lateral_shift", step: 0.5 },
  { test: (k) => k === "servo_horn_height", step: 1 },
  { test: (k) => k === "ackermann_position", step: 1 },
  { test: (k) => k === "body_position_from_windshield", step: 1 },
  { test: (k) => k === "bodyshell_upstop_height", step: 0.5 },

  // ── Counted fasteners / cuts: one screw. ───────────────────────────────────────────────────────
  { test: (k) => k === "motor_mount_screws", step: 1 },
  { test: (k) => k === "top_deck_screws", step: 1 },
  { test: (k) => k === "top_deck_cuts", step: 1 },

  // ── Categorical / part-choice rows: no step, no bands. ─────────────────────────────────────────
  { test: (k) => k === "chassis", step: null },
  { test: (k) => k === "front_bumper", step: null },
  { test: (k) => k.startsWith("c45_installed_"), step: null },
  { test: (k) => k.startsWith("side_wall_glue_"), step: null },
];

/**
 * Size of one normal adjustment on this parameter, or `null` when unknown / not stepped.
 * A `null` here means the parameter gets no base-setup bands — that is the correct outcome, not a
 * gap to paper over with a default.
 */
export function getParameterStep(parameterKey: string): number | null {
  for (const rule of STEP_RULES) {
    if (rule.test(parameterKey)) return rule.step;
  }
  return null;
}
