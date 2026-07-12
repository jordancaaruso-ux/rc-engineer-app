/**
 * Roll center engine tests. Run: npx tsx --test src/lib/rollCenter/rollCenter.test.ts
 * (script: npm run test:roll-center)
 *
 * The anchor is the VSUSP cross-check (2026-07-11): on the founder's measured
 * Awesomatix A800R project, VSUSP displays front RC −9.1 / rear −8.5; this engine
 * must reproduce −9.09 / −8.50. If these drift, the geometry model changed — stop.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeAxleMetrics, solveAxle, solveCamberTrim, ZERO_ADJUSTMENTS } from "./engine";
import { parseVsuspUrl } from "./vsusp";
import { AWESOMATIX_A800_PACK, chassisMountShiftMm, resolvePackForSnapshot } from "./packs";
import { computeRollCenterFromSnapshot } from "./computeFromSnapshot";

const FOUNDER_VSUSP_URL = `https://www.vsusp.com/#0.8%26project_name%3AA800R%20No%20Shims%20-%20STEEL%26trim%7Bbody_roll_angle%3A0%7Cfront.left_bump%3A0%7Crear.left_bump%3A0%7Cfront.right_bump%3A0%7Crear.right_bump%3A0%7D%26front%7Bframe.susp_type%3A0%7Cframe.bottom_y%3A5000%7Cframe.center_to_upper_mount_x%3A19500%7Cframe.bottom_to_upper_mount_y%3A34500%7Cframe.center_to_lower_mount_x%3A10500%7Cframe.bottom_to_lower_mount_y%3A4450%7Ccontrol_arms.upper_length%3A50691%7Ccontrol_arms.lower_length%3A60500%7Cknuckles.hub_to_upper_x%3A16200%7Cknuckles.hub_to_lower_x%3A16300%7Cknuckles.hub_to_lower_y%3A15000%7Cknuckles.hub_to_upper_y%3A14500%7Cknuckles.hub_to_strut_axis%3A14000%7Cknuckles.strut_incl%3A8000%7Csteering.active%3A0%7Csteering.hub_to_outer_tie_rod_x%3A7620%7Csteering.hub_to_outer_tie_rod_y%3A7620%7Cwheels.offset%3A5220%7Cwheels.diameter%3A1500%7Cwheels.diameter_expl%3A52000%7Ctires.size_convention%3A1%7Ctires.section_width%3A19500%7Ctires.aspect_ratio%3A4500%7Ctires.diameter_expl%3A64000%7Ctires.width_expl%3A24300%7Ctires.compression%3A125%7D%26rear%7Bframe.susp_type%3A0%7Cframe.bottom_y%3A5200%7Cframe.center_to_upper_mount_x%3A19500%7Cframe.bottom_to_upper_mount_y%3A34500%7Cframe.center_to_lower_mount_x%3A9000%7Cframe.bottom_to_lower_mount_y%3A4450%7Ccontrol_arms.upper_length%3A49197%7Ccontrol_arms.lower_length%3A60500%7Cknuckles.hub_to_upper_x%3A16200%7Cknuckles.hub_to_lower_x%3A16300%7Cknuckles.hub_to_lower_y%3A15000%7Cknuckles.hub_to_upper_y%3A14500%7Cknuckles.hub_to_strut_axis%3A14000%7Cknuckles.strut_incl%3A8000%7Csteering.active%3A0%7Csteering.hub_to_outer_tie_rod_x%3A7620%7Csteering.hub_to_outer_tie_rod_y%3A7620%7Cwheels.offset%3A5220%7Cwheels.diameter%3A1500%7Cwheels.diameter_expl%3A52000%7Ctires.size_convention%3A1%7Ctires.section_width%3A19500%7Ctires.aspect_ratio%3A4500%7Ctires.diameter_expl%3A64000%7Ctires.width_expl%3A24300%7Ctires.compression%3A125%7D`;

test("VSUSP URL parses to the embedded A800 pack numbers", () => {
  const project = parseVsuspUrl(FOUNDER_VSUSP_URL);
  assert.ok(project, "parser returned null");
  assert.equal(project.name, "A800R No Shims - STEEL");
  assert.deepEqual(project.front, AWESOMATIX_A800_PACK.front);
  assert.deepEqual(project.rear, AWESOMATIX_A800_PACK.rear);
});

test("VSUSP cross-check: front RC −9.09, rear RC −8.50 at no shims", () => {
  const front = computeAxleMetrics(AWESOMATIX_A800_PACK.front, ZERO_ADJUSTMENTS);
  const rear = computeAxleMetrics(AWESOMATIX_A800_PACK.rear, ZERO_ADJUSTMENTS);
  assert.ok(front && rear, "static solve failed");
  assert.ok(Math.abs(front.rcHeightMm - -9.09) < 0.02, `front RC ${front.rcHeightMm}`);
  assert.ok(Math.abs(rear.rcHeightMm - -8.5) < 0.02, `rear RC ${rear.rcHeightMm}`);
  // Sanity anchors from the validated prototype:
  assert.ok(Math.abs(front.camberDeg - -1.78) < 0.05, `front camber ${front.camberDeg}`);
  assert.ok(Math.abs(front.trackMm + 24.3 - 188.7) < 0.5, `overall width ${front.trackMm + 24.3}`);
  assert.ok(Math.abs(front.lowerArmAngleDeg - 6.71) < 0.1, `lower arm ${front.lowerArmAngleDeg}`);
  assert.ok(Math.abs(front.upperLinkAngleDeg - 7.38) < 0.1, `upper link ${front.upperLinkAngleDeg}`);
});

test("shim directions match A800 behavior", () => {
  const geo = AWESOMATIX_A800_PACK.front;
  const rc = (adj: Partial<typeof ZERO_ADJUSTMENTS>) => {
    const m = computeAxleMetrics(geo, { ...ZERO_ADJUSTMENTS, ...adj });
    assert.ok(m);
    return m.rcHeightMm;
  };
  const base = rc({});
  // Founder-vocabulary sensitivities (mm RC per mm of stack):
  assert.ok(rc({ underLowerArmMm: 1 }) - base > 1.8, "under lower arm raises RC ~+2.2");
  assert.ok(rc({ underHubMm: 1 }) - base > 1.7, "under hub raises RC ~+2.1");
  assert.ok(rc({ upperInnerMm: 1 }) - base < -0.7, "upper inner lowers RC ~−1.0");
  assert.ok(rc({ upperOuterMm: 1 }) - base > 0.7, "upper outer raises RC ~+1.0");
  assert.ok(rc({ rideDeltaMm: 1 }) - base > 0.8, "ride height raises RC vs ground");
});

test("camber gain is small and negative; roll solve works", () => {
  const m = computeAxleMetrics(AWESOMATIX_A800_PACK.front, ZERO_ADJUSTMENTS);
  assert.ok(m && m.camberGainDegPerMm != null);
  assert.ok(m.camberGainDegPerMm < 0 && m.camberGainDegPerMm > -0.2, `gain ${m.camberGainDegPerMm}`);
  const rolled = solveAxle(AWESOMATIX_A800_PACK.front, ZERO_ADJUSTMENTS, 3);
  assert.ok(rolled && rolled.rollCentre, "3° roll solve failed");
});

test("camber back-solve hits a target within 0.01°", () => {
  const geo = AWESOMATIX_A800_PACK.front;
  const trim = solveCamberTrim(geo, ZERO_ADJUSTMENTS, -2.5);
  assert.ok(trim != null, "trim solve failed");
  const m = computeAxleMetrics(geo, { ...ZERO_ADJUSTMENTS, camberTrimMm: trim });
  assert.ok(m);
  assert.ok(Math.abs(m.camberDeg - -2.5) < 0.01, `camber ${m.camberDeg}`);
});

test("snapshot fingerprint resolves the pack only for Awesomatix-shaped data", () => {
  assert.equal(
    resolvePackForSnapshot({ under_hub_shims_front: "1", upper_inner_shims_ff: "0.5" }),
    AWESOMATIX_A800_PACK
  );
  assert.equal(resolvePackForSnapshot({ camber_front: "2.0", spring_front: "X1" }), null);
  assert.equal(resolvePackForSnapshot({ under_hub_shims_front: "" }), null);
});

test("chassis codes shift the mount datum (steel base)", () => {
  assert.equal(chassisMountShiftMm(AWESOMATIX_A800_PACK, "C01RS"), 0);
  assert.equal(chassisMountShiftMm(AWESOMATIX_A800_PACK, "C01B-RC")?.toFixed(1), "1.0");
  assert.equal(chassisMountShiftMm(AWESOMATIX_A800_PACK, "C01B-RAF")?.toFixed(1), "0.8");
});

test("computeRollCenterFromSnapshot: realistic sheet values (strings), camber matched", () => {
  const snapshot: Record<string, unknown> = {
    under_lower_arm_shims_ff: "0.5",
    under_lower_arm_shims_fr: "0.5",
    under_lower_arm_shims_rf: "1",
    under_lower_arm_shims_rr: "1",
    upper_inner_shims_ff: "1.0",
    upper_inner_shims_fr: "1.0",
    upper_inner_shims_rf: "0.5",
    upper_inner_shims_rr: "0.5",
    under_hub_shims_front: "0.5",
    under_hub_shims_rear: "0",
    upper_outer_shims_front: "1",
    upper_outer_shims_rear: "1",
    chassis: "C01B-RC",
    ride_height_front: "5.2",
    ride_height_rear: "5.4",
    camber_front: "2.0",
    camber_rear: "1.5",
  };
  const result = computeRollCenterFromSnapshot(snapshot);
  assert.ok(result, "compute returned null");
  assert.equal(result.verificationGrade, "cross-checked");
  // Camber back-solve should land on the sheet values (recorded as magnitudes of negative).
  assert.ok(Math.abs(result.front.camberDeg - -2.0) < 0.02, `front camber ${result.front.camberDeg}`);
  assert.ok(Math.abs(result.rear.camberDeg - -1.5) < 0.02, `rear camber ${result.rear.camberDeg}`);
  // Shims applied: this setup raises the front RC well above the no-shim baseline.
  assert.ok(result.front.rcHeightMm > -9.09 + 1.0, `front RC ${result.front.rcHeightMm}`);
  assert.equal(result.rakeMm.toFixed(2), (result.rear.rcHeightMm - result.front.rcHeightMm).toFixed(2));
  // Tire Ø is always an assumption (no canonical key yet).
  assert.ok(result.assumptions.some((a) => a.includes("tire")));
});

test("computeRollCenterFromSnapshot: sparse sheet computes with flagged assumptions", () => {
  const result = computeRollCenterFromSnapshot({
    under_hub_shims_front: "1",
    upper_inner_shims_ff: "0.5",
  });
  assert.ok(result, "sparse compute returned null");
  assert.ok(result.assumptions.length >= 4, `assumptions: ${result.assumptions.join("; ")}`);
  // Missing chassis defaults to the pack base (steel).
  assert.ok(result.assumptions.some((a) => a.includes("chassis assumed steel")));
});

test("non-Awesomatix snapshot returns null (no pack)", () => {
  assert.equal(computeRollCenterFromSnapshot({ camber_front: "2" }), null);
});

test("deltas are datum-robust: shim delta survives a base-geometry error", () => {
  // Perturb a datum by 0.5mm (simulating hand-measurement error): the ABSOLUTE RC
  // moves, but the DELTA from +1mm under-hub barely changes. This is the trust doctrine.
  const geo = AWESOMATIX_A800_PACK.front;
  const wrongGeo = { ...geo, lowerInnerZrel: geo.lowerInnerZrel + 0.5 };
  const d = (g: typeof geo) => {
    const a = computeAxleMetrics(g, ZERO_ADJUSTMENTS);
    const b = computeAxleMetrics(g, { ...ZERO_ADJUSTMENTS, underHubMm: 1 });
    assert.ok(a && b);
    return b.rcHeightMm - a.rcHeightMm;
  };
  assert.ok(Math.abs(d(geo) - d(wrongGeo)) < 0.1, `delta drift ${Math.abs(d(geo) - d(wrongGeo))}`);
});
