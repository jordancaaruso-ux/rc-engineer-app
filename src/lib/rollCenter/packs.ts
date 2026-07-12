/**
 * Platform geometry packs — base hardpoints per car model + the option tables
 * that map sheet build choices onto geometry.
 *
 * v1 ships packs as a code registry. The JSON shape here is the contract for the
 * future `SetupSheetModel` pack column + VSUSP-import admin flow (north star:
 * "authored via an admin page; no code change per new car" — that lands with the
 * second platform, not the first).
 */
import type { AxleGeometry } from "./engine";

export type PackVerificationGrade = "measured" | "cross-checked" | "cad-verified";

export type ChassisOption = {
  label: string;
  thicknessMm: number;
};

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
  chassisOptions: {
    C01RS: { label: "Steel", thicknessMm: 1.2 },
    "C01B-RC": { label: "Carbon", thicknessMm: 2.2 },
    "C01B-RAF": { label: "Alu", thicknessMm: 2.0 },
  },
  baseChassisCode: "C01RS",
};

/** Sheet keys whose presence fingerprints an Awesomatix A800-family snapshot. */
const A800_FINGERPRINT_KEYS = [
  "under_hub_shims_front",
  "under_lower_arm_shims_ff",
  "upper_inner_shims_ff",
  "upper_outer_shims_front",
] as const;

/**
 * Resolve the platform pack from a setup snapshot. The Awesomatix shim keys only
 * exist on Awesomatix sheets, so key presence is a reliable fingerprint — this keeps
 * every call site template-agnostic (mirrors `inferA800RRSetupFromSnapshotData`).
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

/** Datum shift for a chassis choice vs the chassis the pack was measured on. */
export function chassisMountShiftMm(pack: RollCenterPack, chassisCode: string | null): number | null {
  if (!chassisCode) return null;
  const base = pack.chassisOptions[pack.baseChassisCode];
  const chosen = pack.chassisOptions[chassisCode];
  if (!base || !chosen) return null;
  return chosen.thicknessMm - base.thicknessMm;
}
