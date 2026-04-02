import type { SetupSnapshotData } from "@/lib/runSetup";
import {
  computeA800rrDerived,
  DERIVED_FINAL_DRIVE_RATIO_KEY,
  DERIVED_FRONT_SPRING_RATE_KEY,
  DERIVED_REAR_SPRING_RATE_KEY,
  IMPORTED_DISPLAY_FINAL_DRIVE_RATIO_KEY,
  IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY,
  IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY,
  type A800rrDerivedDiagnostics,
} from "@/lib/setupCalculations/a800rrDerived";

export type DerivedFieldStatus =
  | "computed"
  | "computed_with_validation"
  | "computed_no_imported_comparison"
  | "imported_display_only"
  | "formula_missing"
  | "lookup_missing"
  | "unsupported_lookup_value"
  | "missing_input_value"
  | "missing_input_mapping"
  | "not_available_on_sheet"
  | "validation_mismatch"
  /** @deprecated Prefer missing_input_value / missing_input_mapping */
  | "pending_formula";

function looksLikeSpringRateKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("spring") && (k.includes("rate") || k.includes("gf"));
}

function looksLikeFrontKey(key: string): boolean {
  return /(^|_)front(_|$)|\bff\b/i.test(key);
}

function looksLikeRearKey(key: string): boolean {
  return /(^|_)rear(_|$)|\brr\b/i.test(key);
}

export function rewriteImportedSpringRateKey(canonicalKey: string): string {
  if (!looksLikeSpringRateKey(canonicalKey)) return canonicalKey;
  if (canonicalKey === DERIVED_FRONT_SPRING_RATE_KEY || canonicalKey === DERIVED_REAR_SPRING_RATE_KEY) {
    return canonicalKey;
  }
  if (looksLikeFrontKey(canonicalKey)) return IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY;
  if (looksLikeRearKey(canonicalKey)) return IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY;
  return canonicalKey;
}

export function rewriteImportedCalculatedDisplayKey(canonicalKey: string): string {
  const k = canonicalKey.trim();
  if (!k) return k;
  if (k.toLowerCase() === "text91") return IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY;
  if (k.toLowerCase() === "text93") return IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY;
  if (k === "ratio") return IMPORTED_DISPLAY_FINAL_DRIVE_RATIO_KEY;
  if (k === DERIVED_FINAL_DRIVE_RATIO_KEY) return k;
  return rewriteImportedSpringRateKey(k);
}

function springSideStatus(
  side: "front" | "rear",
  diagnostics: A800rrDerivedDiagnostics
): DerivedFieldStatus {
  const computed =
    side === "front"
      ? diagnostics.computed.frontSpringRateGfMm
      : diagnostics.computed.rearSpringRateGfMm;
  const importedDisp =
    side === "front"
      ? diagnostics.importedDisplay.frontSpringRateGfMm
      : diagnostics.importedDisplay.rearSpringRateGfMm;
  const validation =
    side === "front"
      ? diagnostics.validation.frontSpringRateGfMm
      : diagnostics.validation.rearSpringRateGfMm;
  const resolution =
    side === "front" ? diagnostics.springFrontResolution : diagnostics.springRearResolution;

  if (computed != null) {
    if (validation.status === "matched") return "computed_with_validation";
    if (validation.status === "no_imported_comparison") return "computed_no_imported_comparison";
    if (validation.status === "mismatch") return "validation_mismatch";
    return "computed";
  }
  if (importedDisp != null) return "imported_display_only";
  switch (resolution) {
    case "missing_input_value":
      return "missing_input_value";
    case "missing_input_mapping":
      return "missing_input_mapping";
    case "unsupported_lookup_value":
      return "unsupported_lookup_value";
    case "lookup_missing":
      return "lookup_missing";
    default:
      return "missing_input_value";
  }
}

function finalDriveStatus(diagnostics: A800rrDerivedDiagnostics): DerivedFieldStatus {
  const { computed, validation, importedDisplay, inputs } = diagnostics;
  if (computed.finalDriveRatio != null) {
    if (validation.finalDriveRatio.status === "matched") return "computed_with_validation";
    if (validation.finalDriveRatio.status === "no_imported_comparison") return "computed_no_imported_comparison";
    if (validation.finalDriveRatio.status === "mismatch") return "validation_mismatch";
    return "computed";
  }
  if (importedDisplay.finalDriveRatio != null) return "imported_display_only";
  const { spur, pinion } = inputs.finalDrive;
  if (spur == null || pinion == null) return "missing_input_value";
  if (pinion === 0) return "missing_input_value";
  return "formula_missing";
}

/**
 * Rich derived-field statuses for debugging (review / diagnostics).
 * Requires full A800RR diagnostics — use {@link deriveFieldStatuses} when you only have a snapshot.
 */
export function computeDetailedDerivedFieldStatuses(
  _setup: SetupSnapshotData,
  diagnostics: A800rrDerivedDiagnostics
): Record<string, DerivedFieldStatus> {
  return {
    [DERIVED_FRONT_SPRING_RATE_KEY]: springSideStatus("front", diagnostics),
    [DERIVED_REAR_SPRING_RATE_KEY]: springSideStatus("rear", diagnostics),
    [DERIVED_FINAL_DRIVE_RATIO_KEY]: finalDriveStatus(diagnostics),
  };
}

/** Back-compat: same keys as {@link computeDetailedDerivedFieldStatuses}, single pass from snapshot. */
export function deriveFieldStatuses(setup: SetupSnapshotData): Record<string, DerivedFieldStatus> {
  return computeDetailedDerivedFieldStatuses(setup, computeA800rrDerived(setup).diagnostics);
}

/**
 * @deprecated Use {@link deriveFieldStatuses} — kept for any external imports.
 */
export function computeSpringRateDerivedStatuses(setup: SetupSnapshotData): Record<string, DerivedFieldStatus> {
  return deriveFieldStatuses(setup);
}
