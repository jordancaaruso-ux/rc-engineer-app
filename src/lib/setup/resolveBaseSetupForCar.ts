import { normalizeSetupData, type SetupSnapshotData, type SetupSnapshotValue } from "@/lib/runSetup";
import { setupValueToNumber } from "@/lib/setup/parseSetupNumeric";
import {
  computeSetupGeometryDerivedMetrics,
  isSetupGeometryDerivedKey,
  type SetupGeometryDerivedMetrics,
} from "@/lib/setupAggregations/setupGeometryDerivedMetrics";

/** Where a base setup came from. Only manufacturer kit setups for now. */
export type BaseSetupRef = { kind: "kit"; modelName: string };

export type BaseSetupReference = {
  ref: BaseSetupRef;
  data: SetupSnapshotData;
  /** Derived geometry (RC heights, arm angles) computed from the base data, same as for a run. */
  derived: SetupGeometryDerivedMetrics;
};

/**
 * Build the reference a car's position bands are measured against, from its setup-sheet model's
 * admin-entered kit setup (`SetupSheetModel.kitSetupJson`).
 *
 * Pure on purpose — the caller supplies the already-loaded model row so this stays testable without
 * a database and adds no extra query. `kitSetupJson` is stored in `SetupSnapshot.data` shape, so
 * after `normalizeSetupData` its keys line up with the driver's own snapshot for free.
 *
 * Returns null when the car has no model, the model has no kit setup, or the kit setup is empty.
 * That is the common case today and must stay cheap and silent: no bands, no warning, behaviour
 * exactly as it was before base setups existed.
 */
export function buildBaseSetupReference(params: {
  kitSetupJson: unknown;
  modelName: string;
}): BaseSetupReference | null {
  if (params.kitSetupJson == null) return null;
  const data = normalizeSetupData(params.kitSetupJson);
  if (Object.keys(data).length === 0) return null;
  return {
    ref: { kind: "kit", modelName: params.modelName },
    data,
    derived: computeSetupGeometryDerivedMetrics(data as Record<string, SetupSnapshotValue>),
  };
}

/**
 * Numeric base value for one parameter key, or null when the base setup has no usable number there.
 * Derived geometry keys read from the computed metrics rather than the raw data, mirroring how the
 * driver's own value is resolved in `setupSpreadForEngineer`.
 */
export function baseSetupValueForKey(base: BaseSetupReference, key: string): number | null {
  if (isSetupGeometryDerivedKey(key)) {
    const v = base.derived[key];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return setupValueToNumber(base.data[key]);
}
