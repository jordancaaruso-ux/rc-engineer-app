import type { SetupSnapshotData } from "@/lib/runSetup";
import { normalizeCalibrationData } from "@/lib/setupCalibrations/types";
import {
  deriveFieldStatuses,
  type DerivedFieldStatus,
} from "@/lib/setup/derivedFields";
import {
  applyA800rrDerivedToSetup,
  computeA800rrDerived,
  DERIVED_FRONT_SPRING_RATE_KEY,
  DERIVED_REAR_SPRING_RATE_KEY,
} from "@/lib/setupCalculations/a800rrDerived";

export type DerivedSetupRenderValues = {
  springFrontRateGfMm?: number | null;
  springRearRateGfMm?: number | null;
  finalDriveRatio?: number | null;
};

export function deriveSetupRenderValues(setup: SetupSnapshotData): DerivedSetupRenderValues {
  const { computed } = computeA800rrDerived(setup);
  return {
    springFrontRateGfMm: computed.frontSpringRateGfMm,
    springRearRateGfMm: computed.rearSpringRateGfMm,
    finalDriveRatio: computed.finalDriveRatio,
  };
}

function looksLikeFrontKey(k: string): boolean {
  return /(^|_)front(_|$)|\bff\b/i.test(k);
}
function looksLikeRearKey(k: string): boolean {
  return /(^|_)rear(_|$)|\brr\b/i.test(k);
}

/**
 * Produces a patch to apply to the render-input setup object.
 * We only touch keys that look like spring-rate / gf-mm fields present in the calibration.
 * If derived value is null, the key is *cleared* (deleted) to avoid stale imported values.
 */
export function buildDerivedRenderPatch(input: {
  setup: SetupSnapshotData;
  calibrationJson: unknown;
}): { set: Record<string, string>; clear: string[]; debug: string[] } {
  const cal = normalizeCalibrationData(input.calibrationJson);
  const candidateKeys = new Set<string>();
  for (const k of Object.keys(cal.fields ?? {})) candidateKeys.add(k);
  for (const k of Object.keys(cal.formFieldMappings ?? {})) candidateKeys.add(k);

  const derived = deriveSetupRenderValues(input.setup);
  const statuses = deriveFieldStatuses(input.setup);
  const set: Record<string, string> = {};
  const clear: string[] = [];
  const debug: string[] = [];

  const rateKeys = [...candidateKeys].filter((k) => /spring/i.test(k) && /(gf|rate)/i.test(k));
  for (const key of rateKeys) {
    if (looksLikeFrontKey(key)) {
      if (derived.springFrontRateGfMm != null) set[key] = String(derived.springFrontRateGfMm);
      else clear.push(key);
      debug.push(`frontRateKey:${key}=${derived.springFrontRateGfMm ?? "null"} status=${statuses[DERIVED_FRONT_SPRING_RATE_KEY]}`);
      continue;
    }
    if (looksLikeRearKey(key)) {
      if (derived.springRearRateGfMm != null) set[key] = String(derived.springRearRateGfMm);
      else clear.push(key);
      debug.push(`rearRateKey:${key}=${derived.springRearRateGfMm ?? "null"} status=${statuses[DERIVED_REAR_SPRING_RATE_KEY]}`);
      continue;
    }
  }
  const ratioKeys = [...candidateKeys].filter((k) => /(^|_)ratio(_|$)|final.*drive/i.test(k));
  for (const key of ratioKeys) {
    if (derived.finalDriveRatio != null) {
      set[key] = String(derived.finalDriveRatio);
      debug.push(`finalDriveRatioKey:${key}=${derived.finalDriveRatio}`);
    } else {
      clear.push(key);
      debug.push(`finalDriveRatioKey:${key}=null`);
    }
  }

  return { set, clear, debug };
}

export { deriveFieldStatuses };

export function applyDerivedFieldsToSnapshot(setup: SetupSnapshotData): SetupSnapshotData {
  return applyA800rrDerivedToSetup(setup).setup;
}

export function deriveComputedFieldDiagnostics(setup: SetupSnapshotData) {
  return computeA800rrDerived(setup).diagnostics;
}

