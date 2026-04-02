import type { SetupSnapshotData } from "@/lib/runSetup";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import {
  computeSpringRateLookupForSide,
  hintForSpringLookup,
  type SpringLookupResolutionCode,
  type SpringLookupSideInput,
} from "@/lib/setupCalculations/springRateLookup";

export const DERIVED_FRONT_SPRING_RATE_KEY = "front_spring_rate_gf_mm";
export const DERIVED_REAR_SPRING_RATE_KEY = "rear_spring_rate_gf_mm";
export const DERIVED_FINAL_DRIVE_RATIO_KEY = "final_drive_ratio";

export const IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY = "imported_displayed_front_spring_rate_gf_mm";
export const IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY = "imported_displayed_rear_spring_rate_gf_mm";
export const IMPORTED_DISPLAY_FINAL_DRIVE_RATIO_KEY = "imported_displayed_final_drive_ratio";

export type DerivedValidationStatus =
  | "matched"
  | "mismatch"
  | "no_imported_comparison"
  | "missing_input_value";

export type A800rrDerivedInputs = {
  springLookup: {
    front: SpringLookupSideInput;
    rear: SpringLookupSideInput;
  };
  finalDrive: {
    spur: number | null;
    pinion: number | null;
  };
};

export type A800rrDerivedComputed = {
  frontSpringRateGfMm: number | null;
  rearSpringRateGfMm: number | null;
  finalDriveRatio: number | null;
};

export type DerivedValidationRow = {
  computed: number | null;
  imported: number | null;
  absDelta: number | null;
  status: DerivedValidationStatus;
};

export type A800rrDerivedValidation = {
  frontSpringRateGfMm: DerivedValidationRow;
  rearSpringRateGfMm: DerivedValidationRow;
  finalDriveRatio: DerivedValidationRow;
};

export type A800rrDerivedDiagnostics = {
  formula: "a800rr_spring_lookup_table_v1";
  inputs: A800rrDerivedInputs;
  computed: A800rrDerivedComputed;
  importedDisplay: {
    frontSpringRateGfMm: number | null;
    rearSpringRateGfMm: number | null;
    finalDriveRatio: number | null;
  };
  validation: A800rrDerivedValidation;
  springFrontResolution: SpringLookupResolutionCode;
  springRearResolution: SpringLookupResolutionCode;
  resolutionHints: {
    frontSpring: string;
    rearSpring: string;
    finalDrive: string;
  };
};

function toNumber(raw: unknown): number | null {
  return parseNumericFromSetupString(raw, { allowKSuffix: true });
}

export function readNumberByPriority(data: SetupSnapshotData, keys: string[]): number | null {
  for (const k of keys) {
    const n = toNumber(data[k]);
    if (n != null) return n;
  }
  return null;
}

function hintFinalDrive(spur: number | null, pinion: number | null, computed: number | null): string {
  if (computed != null) return "";
  if (spur == null || pinion == null) return "Map spur and pinion to compute final drive.";
  if (pinion === 0) return "Pinion is zero — cannot compute ratio.";
  return "";
}

export function mapSetupToFinalDriveInputs(setup: SetupSnapshotData): A800rrDerivedInputs["finalDrive"] {
  return {
    spur: readNumberByPriority(setup, ["spur"]),
    pinion: readNumberByPriority(setup, ["pinion"]),
  };
}

export function computeFinalDriveRatio(input: A800rrDerivedInputs["finalDrive"]): number | null {
  const { spur, pinion } = input;
  if (spur == null || pinion == null || pinion === 0) return null;
  const ratio = 1.9 * spur / pinion;
  return Number.isFinite(ratio) ? ratio : null;
}

function validateNumericDerived(
  computed: number | null,
  imported: number | null,
  tolerance: number
): DerivedValidationRow {
  if (computed == null) {
    return { computed, imported, absDelta: null, status: "missing_input_value" };
  }
  if (imported == null) {
    return { computed, imported, absDelta: null, status: "no_imported_comparison" };
  }
  const absDelta = Math.abs(computed - imported);
  return {
    computed,
    imported,
    absDelta,
    status: absDelta <= tolerance ? "matched" : "mismatch",
  };
}

export function computeA800rrDerived(setup: SetupSnapshotData): {
  computed: A800rrDerivedComputed;
  diagnostics: A800rrDerivedDiagnostics;
} {
  const frontLookup = computeSpringRateLookupForSide(setup, "front");
  const rearLookup = computeSpringRateLookupForSide(setup, "rear");
  const finalDrive = mapSetupToFinalDriveInputs(setup);
  const computed: A800rrDerivedComputed = {
    frontSpringRateGfMm: frontLookup.rate,
    rearSpringRateGfMm: rearLookup.rate,
    finalDriveRatio: computeFinalDriveRatio(finalDrive),
  };
  const importedDisplay = {
    frontSpringRateGfMm: readNumberByPriority(setup, [IMPORTED_DISPLAY_FRONT_SPRING_RATE_KEY, "text91"]),
    rearSpringRateGfMm: readNumberByPriority(setup, [IMPORTED_DISPLAY_REAR_SPRING_RATE_KEY, "text93"]),
    finalDriveRatio: readNumberByPriority(setup, [IMPORTED_DISPLAY_FINAL_DRIVE_RATIO_KEY, "ratio"]),
  };
  const diagnostics: A800rrDerivedDiagnostics = {
    formula: "a800rr_spring_lookup_table_v1",
    inputs: {
      springLookup: {
        front: frontLookup.input,
        rear: rearLookup.input,
      },
      finalDrive,
    },
    computed,
    importedDisplay,
    validation: {
      frontSpringRateGfMm: validateNumericDerived(computed.frontSpringRateGfMm, importedDisplay.frontSpringRateGfMm, 0.03),
      rearSpringRateGfMm: validateNumericDerived(computed.rearSpringRateGfMm, importedDisplay.rearSpringRateGfMm, 0.03),
      finalDriveRatio: validateNumericDerived(computed.finalDriveRatio, importedDisplay.finalDriveRatio, 0.002),
    },
    springFrontResolution: frontLookup.resolution,
    springRearResolution: rearLookup.resolution,
    resolutionHints: {
      frontSpring: hintForSpringLookup("Front", frontLookup.input, frontLookup.resolution),
      rearSpring: hintForSpringLookup("Rear", rearLookup.input, rearLookup.resolution),
      finalDrive: hintFinalDrive(finalDrive.spur, finalDrive.pinion, computed.finalDriveRatio),
    },
  };
  return { computed, diagnostics };
}

export function applyA800rrDerivedToSetup(setup: SetupSnapshotData): {
  setup: SetupSnapshotData;
  diagnostics: A800rrDerivedDiagnostics;
} {
  const { computed, diagnostics } = computeA800rrDerived(setup);
  const next: SetupSnapshotData = { ...setup };
  if (computed.frontSpringRateGfMm == null) delete next[DERIVED_FRONT_SPRING_RATE_KEY];
  else next[DERIVED_FRONT_SPRING_RATE_KEY] = Number(computed.frontSpringRateGfMm.toFixed(3));
  if (computed.rearSpringRateGfMm == null) delete next[DERIVED_REAR_SPRING_RATE_KEY];
  else next[DERIVED_REAR_SPRING_RATE_KEY] = Number(computed.rearSpringRateGfMm.toFixed(3));
  if (computed.finalDriveRatio == null) delete next[DERIVED_FINAL_DRIVE_RATIO_KEY];
  else next[DERIVED_FINAL_DRIVE_RATIO_KEY] = Number(computed.finalDriveRatio.toFixed(4));
  return { setup: next, diagnostics };
}

export function isDerivedSetupKey(key: string): boolean {
  return key === DERIVED_FRONT_SPRING_RATE_KEY
    || key === DERIVED_REAR_SPRING_RATE_KEY
    || key === DERIVED_FINAL_DRIVE_RATIO_KEY;
}
