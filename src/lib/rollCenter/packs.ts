/**
 * Platform geometry packs — base hardpoints per car model + the option tables
 * that map sheet build choices onto geometry.
 *
 * v1 ships packs as a code registry. The JSON shape here is the contract for the
 * future `SetupSheetModel` pack column + VSUSP-import admin flow (north star:
 * "authored via an admin page; no code change per new car" — that lands with the
 * second platform, not the first).
 */
import { SETUP_SHEET_TEMPLATE_A800RR } from "@/lib/setupSheetTemplateId";
import type { AxleGeometry } from "./engine";

export type PackVerificationGrade =
  | "measured"
  | "cross-checked"
  | "cad-verified"
  /**
   * Not a car. The teaching model below — invented round numbers that stand in when we have
   * no measurements for the car in front of us. Nothing computed from it is anyone's geometry.
   */
  | "teaching-model";

export type ChassisOption = {
  label: string;
  thicknessMm: number;
};

/**
 * Plate half-width used when a pack has never had one measured. Drawn only — see
 * `chassisHalfWidthMm` below — so a default here can never move a number, and the schematic
 * draws it dashed to say as much.
 */
export const DEFAULT_CHASSIS_HALF_WIDTH_MM = 45;

export type RollCenterPack = {
  id: string;
  displayName: string;
  /**
   * Trust grade for ABSOLUTE outputs (deltas are datum-robust and never tagged):
   * measured = hand-measured hardpoints · cross-checked = engine output matches an
   * established external calculator on this pack · cad-verified = confirmed vs CAD/drawings.
   */
  verificationGrade: PackVerificationGrade;
  /** Provenance: the VSUSP project these hardpoints came from. */
  vsuspUrl?: string;
  front: AxleGeometry;
  rear: AxleGeometry;
  /** Sheet `chassis` choice code → plate option. Mount heights shift by (thickness − base). */
  chassisOptions: Record<string, ChassisOption>;
  /** The chassis the pack's hardpoints were measured on. */
  baseChassisCode: string;
  /**
   * Half the chassis plate's width at the axle line, mm. **Drawn and nothing else** — it never
   * enters a solve, so it can be absent or approximate without moving a single number. That is
   * what makes it the one hardpoint figure safe to take from a driver with a ruler on a built car.
   * Null means never measured: the schematic falls back to {@link DEFAULT_CHASSIS_HALF_WIDTH_MM}
   * and draws the plate dashed rather than pretending.
   */
  chassisHalfWidthMm: number | null;
  /**
   * True only on the teaching model. Callers use it to seal the sandbox off: no save, no export,
   * no Engineer, no stored roll-centre value, nothing into a cross-car aggregate.
   */
  isTeachingModel?: true;
  /**
   * Chassis types these measurements belong to, as community-aggregation template keys (a sheet
   * model's slug key, or a legacy template constant).
   *
   * Geometry is a property of the *car*, not of a snapshot's field names. Adding a car here is a
   * deliberate act taken at the same time as entering its measured hardpoints above — which is what
   * "authorized measurements" means in practice.
   */
  appliesToTemplateKeys: readonly string[];
};

/**
 * Awesomatix A800R/RR — founder-measured, entered into VSUSP ("A800R No Shims - STEEL"),
 * cross-checked 2026-07-11: engine −9.09 F / −8.50 R vs VSUSP −9.1 / −8.5.
 * Numbers are the validated parse of that project (mm).
 */
export const AWESOMATIX_A800_PACK: RollCenterPack = {
  id: "awesomatix_a800",
  displayName: "Awesomatix A800R/RR",
  verificationGrade: "cross-checked",
  vsuspUrl: "https://www.vsusp.com/#0.8 (project: A800R No Shims - STEEL, imported 2026-07-11)",
  front: {
    frameBottom: 5.0,
    upperInnerX: 19.5,
    upperInnerZrel: 34.5,
    lowerInnerX: 10.5,
    lowerInnerZrel: 4.45,
    upperLen: 50.691,
    lowerLen: 60.5,
    hubToUpperX: 16.2,
    hubToUpperY: 14.5,
    hubToLowerX: 16.3,
    hubToLowerY: 15.0,
    wheelOffset: 5.22,
    tireDia: 64,
    tireCompMm: 0.125,
  },
  rear: {
    frameBottom: 5.2,
    upperInnerX: 19.5,
    upperInnerZrel: 34.5,
    lowerInnerX: 9.0,
    lowerInnerZrel: 4.45,
    upperLen: 49.197,
    lowerLen: 60.5,
    hubToUpperX: 16.2,
    hubToUpperY: 14.5,
    hubToLowerX: 16.3,
    hubToLowerY: 15.0,
    wheelOffset: 5.22,
    tireDia: 64,
    tireCompMm: 0.125,
  },
  // Founder 2026-07-11: RS = steel, RC = carbon, RAF = alu; pack measured on steel.
  // Titanium added 2026-08-29 (founder, 1.5mm). Keyed by the material word because it had no
  // Awesomatix code then; since 2026-09-01 it does — C01B-RSL, with its own tick box on the
  // rebuilt sheet — and `detectChassisCode` maps that code (and old "C01RSL" free text) here.
  // The key stays the word so stored Lab states keep resolving.
  chassisOptions: {
    C01RS: { label: "Steel", thicknessMm: 1.2 },
    "C01B-RC": { label: "Carbon", thicknessMm: 2.2 },
    "C01B-RAF": { label: "Alu", thicknessMm: 2.0 },
    TITANIUM: { label: "Titanium", thicknessMm: 1.5 },
  },
  baseChassisCode: "C01RS",
  // Founder-measured 2026-08-19, ruler across the plate at the axle line: 44mm. Drawn only (see
  // the field doc above), so this moves no number — it just stops the plate being a dashed guess.
  chassisHalfWidthMm: 22,
  // Both the built-in A800RR model and the legacy template collapse to this one key via
  // `templateKeyFromModelSlug`. Any other chassis type gets no geometry until its own hardpoints
  // are measured and added as a pack.
  appliesToTemplateKeys: [SETUP_SHEET_TEMPLATE_A800RR],
};

/**
 * The teaching model — a 1/10 touring car nobody races.
 *
 * Every value is a whole or half millimetre **on purpose**: roundness is what stops a driver
 * reading it as a measurement. What is pinned rather than invented comes from the class, not from
 * any brand — 190mm maximum width, 64mm tyres, 5mm ride height, the standard wheel offset every
 * 1/10 TC shares. Only the mount heights and the arm lengths were chosen, and they were chosen so
 * the RATIOS land where real touring cars sit, because ratios are the whole point of the thing:
 * which way a shim moves the roll centre, and roughly how far, holds for any double-wishbone car.
 * The absolute millimetre belongs to nobody.
 *
 * Front and rear are identical (founder, 2026-08-19), so the roll axis starts dead level and the
 * driver makes rake themselves — which teaches better than shipping a built-in one.
 *
 * Solves to: track 164.3mm contact-to-contact (190.3mm overall on a 26mm tyre), RC −9.15,
 * camber −1.94°, lower arm 6.81°, and 1.20mm of RC per mm of ride height — the figure the north
 * star already quotes. Locked by `rollCenter.test.ts`.
 */
const TEACHING_TC_AXLE: AxleGeometry = {
  frameBottom: 5,
  upperInnerX: 20,
  upperInnerZrel: 35,
  lowerInnerX: 11,
  lowerInnerZrel: 4.5,
  upperLen: 50,
  lowerLen: 60,
  hubToUpperX: 16,
  hubToUpperY: 15,
  hubToLowerX: 16,
  hubToLowerY: 15,
  wheelOffset: 5,
  tireDia: 64,
  tireCompMm: 0,
};

export const TEACHING_TC_PACK: RollCenterPack = {
  id: "teaching_tc",
  displayName: "Teaching model · 1/10 touring car",
  verificationGrade: "teaching-model",
  isTeachingModel: true,
  front: { ...TEACHING_TC_AXLE },
  rear: { ...TEACHING_TC_AXLE },
  // A 90mm plate — the one dimension of this car that is drawn rather than solved.
  chassisHalfWidthMm: 45,
  chassisOptions: { PLATE: { label: "2.0mm plate", thicknessMm: 2.0 } },
  baseChassisCode: "PLATE",
  // Belongs to no car, so it can never be resolved by template key. It is only ever a fallback.
  appliesToTemplateKeys: [],
};

const ALL_PACKS: readonly RollCenterPack[] = [AWESOMATIX_A800_PACK];

/**
 * The pack for a chassis type, by community-aggregation template key. This is the only resolver the
 * setup sheet, compare surfaces and aggregations should use.
 *
 * Geometry belongs to the car. Resolving it from snapshot field names instead (see
 * {@link resolvePackForSnapshot}) means any sheet that happens to use the same part names renders
 * another car's hardpoints as if they were its own — confidently wrong numbers, which is the one
 * failure this app treats as unacceptable.
 */
export function resolvePackForTemplateKey(
  templateKey: string | null | undefined
): RollCenterPack | null {
  const key = templateKey?.trim();
  if (!key) return null;
  return ALL_PACKS.find((p) => p.appliesToTemplateKeys.includes(key)) ?? null;
}

/** Sheet keys whose presence hints at an Awesomatix A800-family snapshot. Lab use only. */
const A800_FINGERPRINT_KEYS = [
  "under_hub_shims_front",
  "under_lower_arm_shims_ff",
  "upper_inner_shims_ff",
  "upper_outer_shims_front",
] as const;

/**
 * Resolve a pack by sniffing snapshot field names.
 *
 * **Only for the Geometry Lab**, which is seeded from URL-encoded fields and has no car context.
 * Everywhere a car is known, use {@link resolvePackForTemplateKey} instead: these key names are
 * generic part names ("upper inner shims"), not Awesomatix-specific, and the box-first naming flow
 * mints them from typed labels — so two matching rows on any brand's sheet would otherwise render
 * Awesomatix hardpoints as that car's geometry.
 */
export function resolvePackForSnapshot(
  data: Record<string, unknown>
): RollCenterPack | null {
  let hits = 0;
  for (const key of A800_FINGERPRINT_KEYS) {
    if (key in data && data[key] != null && data[key] !== "") hits++;
  }
  return hits >= 2 ? AWESOMATIX_A800_PACK : null;
}

/**
 * The pack the Geometry Lab draws, which is never null.
 *
 * The Lab is the one surface with no car: it is seeded from URL-encoded fields, opened cold from
 * Tools, or pointed at a setup for a chassis nobody has measured. It used to answer all three by
 * sniffing part names and handing back Awesomatix hardpoints — so an Xray driver got someone
 * else's car, which is the "confidently wrong" failure this file warns about two functions up.
 *
 * Now the sniff only ever *upgrades* the answer. No match means the teaching model, which claims
 * to be nobody's car and says so on screen.
 */
export function resolveLabPack(data: Record<string, unknown>): RollCenterPack {
  return resolvePackForSnapshot(data) ?? TEACHING_TC_PACK;
}

/** Datum shift for a chassis choice vs the chassis the pack was measured on. */
export function chassisMountShiftMm(pack: RollCenterPack, chassisCode: string | null): number | null {
  if (!chassisCode) return null;
  const base = pack.chassisOptions[pack.baseChassisCode];
  const chosen = pack.chassisOptions[chassisCode];
  if (!base || !chosen) return null;
  return chosen.thicknessMm - base.thicknessMm;
}
