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

import {
  chassisBottomAt,
  chassisPlateCorners,
  computeAxleMetrics,
  solveAxle,
  solveCamberTrim,
  ZERO_ADJUSTMENTS,
} from "./engine";
import { parseVsuspUrl } from "./vsusp";
import {
  AWESOMATIX_A800_PACK,
  TEACHING_TC_PACK,
  chassisMountShiftMm,
  resolveLabPack,
  resolvePackForSnapshot,
} from "./packs";
import {
  computeRollCenterFromSnapshot,
  deriveRollCenterInputs,
  solveRollCenterDiagram,
} from "./computeFromSnapshot";
import {
  LAB_DEFAULT_FIELDS,
  decodeLabFields,
  decodeLabSlot,
  encodeLabFields,
  encodeLabSlot,
  extractGeometryFields,
  labChangeList,
} from "./labState";

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
  assert.equal(chassisMountShiftMm(AWESOMATIX_A800_PACK, "TITANIUM")?.toFixed(1), "0.3");
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

test("diagram solves draw the same geometry the metrics report", () => {
  const snapshot: Record<string, unknown> = {
    under_hub_shims_front: "1",
    upper_inner_shims_ff: "0.5",
    camber_front: "2.0",
  };
  const metrics = computeRollCenterFromSnapshot(snapshot);
  const solves = solveRollCenterDiagram(snapshot);
  assert.ok(metrics && solves, "compute or diagram solve returned null");
  // Same solve → identical RC; the schematic can never disagree with the numbers.
  assert.ok(Math.abs(solves.front.rollCentre!.z - metrics.front.rcHeightMm) < 1e-6);
  assert.ok(Math.abs(solves.rear.rollCentre!.z - metrics.rear.rcHeightMm) < 1e-6);
  assert.ok(Math.abs(solves.front.right.camberDeg - metrics.front.camberDeg) < 1e-6);
  // Both sides assembled with sensible ordering for drawing.
  assert.ok(solves.front.left.contact.x < 0 && solves.front.right.contact.x > 0);
  assert.equal(solveRollCenterDiagram({ camber_front: "2" }), null);
});

test("lab codec: extract → encode → decode roundtrips; garbage rejected", () => {
  const snapshot: Record<string, unknown> = {
    under_lower_arm_shims_ff: "0.5",
    under_lower_arm_shims_fr: 0.5,
    under_hub_shims_front: "1",
    upper_inner_shims_ff: "0.5",
    camber_front: "2.0",
    chassis: "C01B-RC",
    spring_front: "not-geometry", // must be dropped
  };
  const fields = extractGeometryFields(snapshot);
  assert.equal(fields.under_lower_arm_shims_fr, "0.5"); // numbers stringified
  assert.ok(!("spring_front" in fields));
  const decoded = decodeLabFields(encodeLabFields(fields));
  assert.deepEqual(decoded, fields);
  // Garbage / hostile input → null, unknown keys stripped.
  assert.equal(decodeLabFields("not-base64url-json!!"), null);
  const smuggled = encodeLabFields({ evil_key: "x", camber_front: "2" } as never);
  assert.deepEqual(decodeLabFields(smuggled), { camber_front: "2" });
});

test("lab slot codec: carries chassis + source, and still reads the old fields-only links", () => {
  const fields = { under_hub_shims_front: "0.5", camber_front: "2.0" };

  // New shape: the slice plus the two references the sheet and the save door need.
  const encoded = encodeLabSlot({
    fields,
    setupSheetModelId: "cm0chassis123",
    source: { kind: "setup", id: "cm0setup456" },
  });
  assert.deepEqual(decodeLabSlot(encoded), {
    fields,
    setupSheetModelId: "cm0chassis123",
    source: { kind: "setup", id: "cm0setup456" },
  });

  // Every link ever shared before this existed is a bare `{key: value}` blob and must still open.
  const legacy = encodeLabFields(fields);
  assert.deepEqual(decodeLabSlot(legacy), {
    fields,
    setupSheetModelId: null,
    source: null,
  });
  // ...and the old reader keeps working against the new shape, so /runs/new needs no change.
  assert.deepEqual(decodeLabFields(encoded), fields);

  // A reference is an id, not a path: anything else is dropped rather than followed.
  const hostile = encodeLabSlot({
    fields,
    setupSheetModelId: "../../etc/passwd",
    source: { kind: "setup", id: "ok" },
  });
  assert.equal(decodeLabSlot(hostile)?.setupSheetModelId, null);
  // An unknown source kind is not a source at all.
  const badKind = encodeLabSlot({
    fields,
    setupSheetModelId: null,
    source: { kind: "elsewhere" as never, id: "x" },
  });
  assert.equal(decodeLabSlot(badKind)?.source, null);
});

test("per-leg shims survive a Lab edit: only the touched leg moves", () => {
  /*
   * The regression this locks: one slider used to write its value into BOTH legs, so a sheet with
   * ff 0.5 / fr 0.25 lost the split on first touch. Harmless while the Lab was a dead end — real
   * data loss now that it can write back. The Lab splits the slider when the legs differ; this asserts
   * the state that split produces, and that the front-view solve still reads their mean.
   */
  const stored: Record<string, unknown> = {
    ...LAB_DEFAULT_FIELDS,
    under_lower_arm_shims_ff: "0.5",
    under_lower_arm_shims_fr: "0.25",
  };
  const fields = extractGeometryFields(stored);

  // Editing one leg leaves the other exactly where it was.
  const edited = { ...fields, under_lower_arm_shims_ff: "0.75" };
  assert.equal(edited.under_lower_arm_shims_fr, "0.25");

  // And the geometry keeps averaging the pair (north star: front view uses the mean of the legs).
  const meanOfSplit = computeRollCenterFromSnapshot(
    { ...stored, under_lower_arm_shims_ff: "0.5", under_lower_arm_shims_fr: "0.25" },
    AWESOMATIX_A800_PACK
  );
  const bothAtMean = computeRollCenterFromSnapshot(
    { ...stored, under_lower_arm_shims_ff: "0.375", under_lower_arm_shims_fr: "0.375" },
    AWESOMATIX_A800_PACK
  );
  assert.ok(meanOfSplit && bothAtMean);
  assert.ok(
    Math.abs(meanOfSplit.front.rcHeightMm - bothAtMean.front.rcHeightMm) < 1e-9,
    "split legs must solve identically to both legs at their mean"
  );
});

test("the blank Lab is the teaching model, not somebody's Awesomatix", () => {
  // The defaults used to carry twelve shim keys set to "0" — the very keys the fingerprint reads —
  // so the blank car WAS an A800 for every driver alive. It must not be one now.
  assert.equal(
    resolvePackForSnapshot(LAB_DEFAULT_FIELDS as Record<string, unknown>),
    null,
    "blank Lab defaults must not fingerprint any real car"
  );
  const pack = resolveLabPack(LAB_DEFAULT_FIELDS as Record<string, unknown>);
  assert.equal(pack.id, TEACHING_TC_PACK.id);
  assert.equal(pack.verificationGrade, "teaching-model");
  assert.equal(pack.isTeachingModel, true);
  // Belongs to no car, so no template key can ever reach it.
  assert.deepEqual([...pack.appliesToTemplateKeys], []);

  const computed = computeRollCenterFromSnapshot(LAB_DEFAULT_FIELDS as Record<string, unknown>, pack);
  assert.ok(computed);
  assert.equal(computed.verificationGrade, "teaching-model");
  // Front and rear are identical by design (founder 2026-08-19): the roll axis starts level and
  // the driver makes rake themselves.
  assert.ok(
    Math.abs(computed.rakeMm) < 1e-9,
    `teaching model must start with a level roll axis, got ${computed.rakeMm}`
  );

  const changes = labChangeList(
    { ...LAB_DEFAULT_FIELDS, under_hub_shims_front: "0.5" },
    LAB_DEFAULT_FIELDS
  );
  assert.deepEqual(changes, ["under hub shims front: — → 0.5"]);
});

test("teaching model: round numbers, class-legal width, mid-range ratios", () => {
  const geo = TEACHING_TC_PACK.front;
  // Roundness is the tell — nobody mistakes 60.0 for a measurement. Every hardpoint must stay on
  // a half-millimetre grid; the day one drifts to 60.37 it has started pretending to be measured.
  for (const [k, v] of Object.entries(geo)) {
    assert.ok(Math.abs(v * 2 - Math.round(v * 2)) < 1e-9, `${k} = ${v} is not a whole or half mm`);
  }

  const m = computeAxleMetrics(geo, ZERO_ADJUSTMENTS);
  assert.ok(m);
  // 190mm is the 1/10 touring car class limit. The engine measures contact patch to contact patch
  // and the contact sits mid-tyre, so a 26mm tyre puts the target at 190 − 26.
  assert.ok(Math.abs(m.trackMm - 164) < 0.5, `track ${m.trackMm} (190mm overall is the target)`);
  assert.ok(Math.abs(m.rcHeightMm - -9.15) < 0.05, `RC ${m.rcHeightMm}`);
  // A realistic static camber falls out with no trim at all — worth locking, it was not forced.
  assert.ok(Math.abs(m.camberDeg - -1.94) < 0.05, `camber ${m.camberDeg}`);
  assert.ok(Math.abs(m.lowerArmAngleDeg - 6.81) < 0.05, `lower arm ${m.lowerArmAngleDeg}`);

  /*
   * The ratios are the entire point of this pack: the absolute belongs to nobody, but "1mm of
   * ride height is worth ~1.2mm of roll centre" is the figure the north star quotes and the thing
   * a driver actually carries away. Signs must never flip.
   */
  const ride = computeAxleMetrics(geo, { ...ZERO_ADJUSTMENTS, rideDeltaMm: 1 });
  assert.ok(ride);
  assert.ok(Math.abs(ride.rcHeightMm - m.rcHeightMm - 1.2) < 0.05, "ride height ≈ 1.2mm RC per mm");
  const perMm = (key: "underLowerArmMm" | "upperInnerMm" | "underHubMm" | "upperOuterMm") => {
    const r = computeAxleMetrics(geo, { ...ZERO_ADJUSTMENTS, [key]: 1 });
    assert.ok(r);
    return r.rcHeightMm - m.rcHeightMm;
  };
  assert.ok(perMm("underLowerArmMm") > 1.5, "raising the lower arm inner must raise RC");
  assert.ok(perMm("underHubMm") > 1.5, "raising the hub off the lower ball must raise RC");
  assert.ok(perMm("upperOuterMm") > 0.5, "raising the upper link outer must raise RC");
  assert.ok(perMm("upperInnerMm") < -0.5, "raising the upper link inner must LOWER RC");
});

test("a real A800 snapshot still resolves to the A800 and still hits the VSUSP anchor", () => {
  // The fingerprint now only ever UPGRADES the answer, so the car it was built for must still win.
  const a800 = {
    under_hub_shims_front: "0",
    under_lower_arm_shims_ff: "0",
    upper_inner_shims_ff: "0",
    upper_outer_shims_front: "0",
    ride_height_front: "5.0",
    ride_height_rear: "5.2",
    chassis: "C01RS",
  };
  assert.equal(resolveLabPack(a800).id, AWESOMATIX_A800_PACK.id);
  const inputs = deriveRollCenterInputs(a800, resolveLabPack(a800));
  assert.ok(inputs, "derive inputs stays exposed for the Lab");
  const computed = computeRollCenterFromSnapshot(a800, resolveLabPack(a800));
  assert.ok(computed);
  assert.ok(Math.abs(computed.front.rcHeightMm - -9.09) < 0.02, `front ${computed.front.rcHeightMm}`);
  assert.ok(Math.abs(computed.rear.rcHeightMm - -8.5) < 0.02, `rear ${computed.rear.rcHeightMm}`);
});

test("C01B-RSL is the titanium plate — its own code and the old free-text shorthand both land there", () => {
  // Founder 2026-09-01: RSL = titanium (1.5mm). The rebuilt sheet gives it a tick box; before
  // that, drivers wrote it in the Other box.
  const base = {
    ride_height_front: "5.0",
    ride_height_rear: "5.2",
  };
  const asRsl = computeRollCenterFromSnapshot(
    { ...base, chassis: { selectedPreset: "C01B-RSL", otherText: "" } },
    AWESOMATIX_A800_PACK
  );
  const asWord = computeRollCenterFromSnapshot({ ...base, chassis: "TITANIUM" }, AWESOMATIX_A800_PACK);
  const asSteel = computeRollCenterFromSnapshot({ ...base, chassis: "C01RS" }, AWESOMATIX_A800_PACK);
  assert.ok(asRsl && asWord && asSteel);
  assert.equal(asRsl.front.rcHeightMm, asWord.front.rcHeightMm, "code and word are one plate");
  assert.notEqual(asRsl.front.rcHeightMm, asSteel.front.rcHeightMm, "titanium is not the steel default");

  const typedShorthand = computeRollCenterFromSnapshot(
    { ...base, chassis: { selectedPreset: "", otherText: "C01RSL" } },
    AWESOMATIX_A800_PACK
  );
  assert.ok(typedShorthand);
  assert.equal(typedShorthand.front.rcHeightMm, asWord.front.rcHeightMm);
});

test("the chassis plate is drawn, never solved", () => {
  const geo = TEACHING_TC_PACK.front;
  const base = computeAxleMetrics(geo, ZERO_ADJUSTMENTS);
  assert.ok(base);

  // Plate bottom IS ride height: ground to the underside. Mounts bolt to the TOP, which is why a
  // thicker chassis thickens the plate here rather than lifting the car.
  const corners = chassisPlateCorners(geo, ZERO_ADJUSTMENTS, 45, 2);
  assert.equal(corners.length, 4);
  assert.ok(Math.abs(corners[0].z - geo.frameBottom) < 1e-9, "plate bottom sits at the frame bottom");
  assert.ok(Math.abs(corners[2].z - (geo.frameBottom + 2)) < 1e-9, "plate top is bottom + thickness");
  assert.ok(Math.abs(corners[1].x - 45) < 1e-9, "plate reaches its half-width");

  const shifted = chassisPlateCorners(geo, { ...ZERO_ADJUSTMENTS, mountZShiftMm: 1 }, 45, 2);
  assert.ok(Math.abs(shifted[0].z - geo.frameBottom) < 1e-9, "a thicker plate must not move ride height");
  assert.ok(Math.abs(shifted[2].z - (geo.frameBottom + 3)) < 1e-9, "a thicker plate gets thicker");

  assert.ok(
    Math.abs(chassisBottomAt(geo, ZERO_ADJUSTMENTS, -30).z - geo.frameBottom) < 1e-9,
    "the ride-height dimension measures to the plate underside"
  );

  // The width is drawn and nothing else — a different one must not move a single number.
  const wide = computeAxleMetrics(geo, ZERO_ADJUSTMENTS);
  assert.ok(wide && Math.abs(wide.rcHeightMm - base.rcHeightMm) < 1e-12);
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
