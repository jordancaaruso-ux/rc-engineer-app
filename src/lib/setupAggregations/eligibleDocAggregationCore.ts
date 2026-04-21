import type { Prisma } from "@prisma/client";
import { SetupAggregationScopeType, SetupAggregationValueType } from "@prisma/client";
import { isTuningComparisonKey } from "@/lib/setupComparison/tuningComparisonKeys";
import { isMultiSelectFieldKey, normalizeMultiSelectValue } from "@/lib/setup/multiSelect";
import {
  displayPresetWithOther,
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
} from "@/lib/setup/presetWithOther";
import { getSingleSelectChipOptions } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import type { SetupSnapshotValue } from "@/lib/runSetup";
import {
  normalizeSetupSnapshotForStorage,
  snapshotValueIsEffectivelyEmpty,
} from "@/lib/runSetup";
import { computeNumericStats } from "@/lib/setupAggregations/numericStats";
import { normalizeParsedSetupData } from "@/lib/setupDocuments/normalize";
import {
  getNumericGradientConfig,
  normalizeNumericForGradientCompare,
} from "@/lib/setupCompare/numericGradientConfig";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";
import { getParameterClassificationOverride } from "@/lib/setupAggregations/parameterClassificationOverrides";

/** At least this many non-empty parameter keys required on the snapshot to count toward aggregation. */
export const MIN_DISTINCT_KEYS_FOR_ELIGIBILITY = 2;

export function snapshotDataHasKeys(raw: unknown): boolean {
  return raw != null && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).length > 0;
}

/**
 * Scalar observation for tuning keys: coerce strings (incl. EU decimal commas) to numbers when safe
 * so rebuild aggregations stay {@link SetupAggregationValueType.NUMERIC} instead of splitting "2.25" vs "2,25".
 */
function tuningScalarObservation(
  key: string,
  v: SetupSnapshotValue
): { tag: "scalar"; nOrS: number | string } | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return { tag: "scalar", nOrS: v };
  }
  if (typeof v === "boolean") {
    return { tag: "scalar", nOrS: v ? "true" : "false" };
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    const n = parseNumericFromSetupString(t, { allowKSuffix: false });
    if (n != null) return { tag: "scalar", nOrS: n };
    return { tag: "scalar", nOrS: t };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const opts = isPresetWithOtherFieldKey(key) ? getSingleSelectChipOptions(key) : null;
    const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
    if (isEmptyPresetWithOther(pov)) return null;
    const displayed = displayPresetWithOther(pov);
    const n = parseNumericFromSetupString(displayed, { allowKSuffix: false });
    if (n != null) return { tag: "scalar", nOrS: n };
    return { tag: "scalar", nOrS: displayed };
  }
  if (Array.isArray(v)) {
    const joined = v
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(", ");
    if (!joined) return null;
    const n = parseNumericFromSetupString(joined, { allowKSuffix: false });
    if (n != null) return { tag: "scalar", nOrS: n };
    const first = v[0];
    const n2 = parseNumericFromSetupString(first, { allowKSuffix: false });
    if (n2 != null) return { tag: "scalar", nOrS: n2 };
    return { tag: "scalar", nOrS: joined };
  }
  const n = parseNumericFromSetupString(v, { allowKSuffix: false });
  if (n != null) return { tag: "scalar", nOrS: n };
  return { tag: "scalar", nOrS: String(v) };
}

/**
 * Prefer committed SetupSnapshot.data; otherwise normalized parsed PDF output.
 * Car id: createdSetup.carId when present, else SetupDocument.carId from upload.
 */
export function resolveNormalizedAggregationData(
  parsedDataJson: unknown,
  createdSetup: { data: unknown } | null
): Record<string, SetupSnapshotValue> | null {
  if (createdSetup && snapshotDataHasKeys(createdSetup.data)) {
    return normalizeSetupSnapshotForStorage(createdSetup.data) as Record<string, SetupSnapshotValue>;
  }
  if (snapshotDataHasKeys(parsedDataJson)) {
    return normalizeSetupSnapshotForStorage(
      normalizeParsedSetupData(parsedDataJson)
    ) as Record<string, SetupSnapshotValue>;
  }
  return null;
}

export function extractObservation(
  key: string,
  v: SetupSnapshotValue
):
  | { tag: "multi"; tokens: string[] }
  | { tag: "scalar"; nOrS: number | string }
  | null {
  if (snapshotValueIsEffectivelyEmpty(v)) return null;

  if (isMultiSelectFieldKey(key)) {
    const tokens = normalizeMultiSelectValue(key, v);
    if (tokens.length === 0) return null;
    return { tag: "multi", tokens };
  }

  const override = getParameterClassificationOverride(key);
  if (override === "numeric") {
    // Reuse the full value-shape handling (strings, preset-with-other objects, arrays, etc.)
    // but drop the observation if it can't be coerced to a finite number — never demote to string.
    const obs = tuningScalarObservation(key, v);
    if (obs && typeof obs.nOrS === "number" && Number.isFinite(obs.nOrS)) {
      return obs;
    }
    return null;
  }
  if (override === "categorical") {
    if (typeof v === "number" && Number.isFinite(v)) return { tag: "scalar", nOrS: String(v) };
    if (typeof v === "boolean") return { tag: "scalar", nOrS: v ? "true" : "false" };
    if (typeof v === "string") {
      const t = v.trim();
      return t === "" ? null : { tag: "scalar", nOrS: t };
    }
    if (Array.isArray(v)) {
      const joined = v.map((x) => String(x).trim()).filter(Boolean).join(", ");
      return joined ? { tag: "scalar", nOrS: joined } : null;
    }
    if (typeof v === "object" && v !== null) {
      const opts = isPresetWithOtherFieldKey(key) ? getSingleSelectChipOptions(key) : null;
      const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
      if (!isEmptyPresetWithOther(pov)) return { tag: "scalar", nOrS: displayPresetWithOther(pov) };
      return null;
    }
    const s = String(v).trim();
    return s === "" ? null : { tag: "scalar", nOrS: s };
  }

  const gradCfg = getNumericGradientConfig(key);
  if (gradCfg) {
    const n = normalizeNumericForGradientCompare(key, gradCfg.normalization, v);
    if (n != null && Number.isFinite(n)) return { tag: "scalar", nOrS: n };
    if (!isTuningComparisonKey(key)) return null;
  }

  if (isTuningComparisonKey(key)) {
    return tuningScalarObservation(key, v);
  }

  if (typeof v === "number" && Number.isFinite(v)) {
    return { tag: "scalar", nOrS: v };
  }
  if (typeof v === "boolean") {
    return { tag: "scalar", nOrS: v ? "true" : "false" };
  }
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return { tag: "scalar", nOrS: n };
    return { tag: "scalar", nOrS: t };
  }
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const opts = isPresetWithOtherFieldKey(key) ? getSingleSelectChipOptions(key) : null;
    const pov = normalizePresetWithOtherFromUnknown(v, undefined, opts);
    if (!isEmptyPresetWithOther(pov)) {
      return { tag: "scalar", nOrS: displayPresetWithOther(pov) };
    }
    return null;
  }
  if (Array.isArray(v)) {
    const joined = v
      .map((x) => String(x).trim())
      .filter(Boolean)
      .join(", ");
    if (!joined) return null;
    return { tag: "scalar", nOrS: joined };
  }
  return { tag: "scalar", nOrS: String(v) };
}

export function countNonEmptyKeys(data: Record<string, SetupSnapshotValue>): number {
  let n = 0;
  for (const v of Object.values(data)) {
    if (!snapshotValueIsEffectivelyEmpty(v)) n += 1;
  }
  return n;
}

export type PerKeyState =
  | {
      kind: "multi";
      tokenDocCount: Map<string, number>;
      documentCount: number;
    }
  | {
      kind: "scalar";
      values: Array<number | string>;
    };

export function getOrCreateBucket(
  map: Map<string, PerKeyState>,
  key: string,
  obs: { tag: "multi"; tokens: string[] } | { tag: "scalar"; nOrS: number | string }
): PerKeyState {
  if (obs.tag === "multi") {
    let b = map.get(key);
    if (!b || b.kind !== "multi") {
      b = { kind: "multi", tokenDocCount: new Map(), documentCount: 0 };
      map.set(key, b);
    }
    const seenInDoc = new Set<string>();
    for (const t of obs.tokens) {
      const norm = t.trim();
      if (!norm) continue;
      const lk = norm.toLowerCase();
      if (seenInDoc.has(lk)) continue;
      seenInDoc.add(lk);
      b.tokenDocCount.set(lk, (b.tokenDocCount.get(lk) ?? 0) + 1);
    }
    b.documentCount += 1;
    return b;
  }

  let b = map.get(key);
  if (!b || b.kind !== "scalar") {
    b = { kind: "scalar", values: [] };
    map.set(key, b);
  }
  b.values.push(obs.nOrS);
  return b;
}

function isBooleanDistribution(freq: Map<string, number>): boolean {
  const keys = [...freq.keys()].map((k) => k.trim().toLowerCase());
  if (keys.length === 0) return false;
  const allowed = new Set(["true", "false"]);
  return keys.every((k) => allowed.has(k));
}

function buildCategoricalJson(freq: Map<string, number>, sampleCount: number) {
  const frequencies = Object.fromEntries([...freq.entries()].sort((a, b) => b[1] - a[1]));
  return {
    distinctCount: freq.size,
    sampleCount,
    frequencies,
  };
}

function rowsFromPerKeyMapShared(
  keyMap: Map<string, PerKeyState>,
  pushRow: (input: {
    parameterKey: string;
    valueType: SetupAggregationValueType;
    sampleCount: number;
    numericStatsJson?: Prisma.InputJsonValue;
    categoricalStatsJson?: Prisma.InputJsonValue;
  }) => void
): void {
  for (const [parameterKey, state] of keyMap) {
    if (state.kind === "multi") {
      const freq = state.tokenDocCount;
      pushRow({
        parameterKey,
        valueType: SetupAggregationValueType.MULTI_SELECT,
        sampleCount: state.documentCount,
        categoricalStatsJson: {
          kind: "multi_select_token_document_frequency",
          sampleCount: state.documentCount,
          tokenDocumentFrequency: Object.fromEntries([...freq.entries()].sort((a, b) => b[1] - a[1])),
          distinctTokenCount: freq.size,
        },
      });
      continue;
    }

    const vals = state.values;
    const override = getParameterClassificationOverride(parameterKey);

    if (override === "numeric") {
      const numericOnly = vals.filter(
        (x): x is number => typeof x === "number" && Number.isFinite(x)
      );
      if (numericOnly.length === 0) continue;
      const stats = computeNumericStats(numericOnly);
      if (stats) {
        pushRow({
          parameterKey,
          valueType: SetupAggregationValueType.NUMERIC,
          sampleCount: stats.sampleCount,
          numericStatsJson: stats as unknown as Prisma.InputJsonValue,
        });
      }
      continue;
    }

    if (override !== "categorical") {
      const allNumeric = vals.every((x) => typeof x === "number" && Number.isFinite(x));
      if (allNumeric && vals.length > 0) {
        const stats = computeNumericStats(vals as number[]);
        if (stats) {
          pushRow({
            parameterKey,
            valueType: SetupAggregationValueType.NUMERIC,
            sampleCount: stats.sampleCount,
            numericStatsJson: stats as unknown as Prisma.InputJsonValue,
          });
        }
        continue;
      }
    }

    const freq = new Map<string, number>();
    for (const x of vals) {
      const s = typeof x === "number" ? String(x) : String(x).trim();
      if (s === "") continue;
      freq.set(s, (freq.get(s) ?? 0) + 1);
    }
    const sampleCount = [...freq.values()].reduce((a, b) => a + b, 0);
    if (sampleCount === 0) continue;

    const bool = override !== "categorical" && isBooleanDistribution(freq);
    pushRow({
      parameterKey,
      valueType: bool ? SetupAggregationValueType.BOOLEAN : SetupAggregationValueType.CATEGORICAL,
      sampleCount,
      categoricalStatsJson: buildCategoricalJson(freq, sampleCount) as unknown as Prisma.InputJsonValue,
    });
  }
}

export function aggregationRowsFromPerKeyMap(
  scopeType: SetupAggregationScopeType,
  scopeKey: string,
  carId: string,
  keyMap: Map<string, PerKeyState>
): Prisma.SetupParameterAggregationCreateManyInput[] {
  const rows: Prisma.SetupParameterAggregationCreateManyInput[] = [];
  rowsFromPerKeyMapShared(keyMap, (input) => {
    rows.push({
      scopeType,
      scopeKey,
      carId,
      parameterKey: input.parameterKey,
      valueType: input.valueType,
      sampleCount: input.sampleCount,
      numericStatsJson: input.numericStatsJson,
      categoricalStatsJson: input.categoricalStatsJson,
    });
  });
  return rows;
}

/** App-wide stats: all users' setup documents marked eligible for the aggregation dataset, grouped by `Car.setupSheetTemplate`. */
export function communityTemplateAggregationRowsFromPerKeyMap(
  setupSheetTemplate: string,
  trackSurface: string,
  gripLevel: string,
  keyMap: Map<string, PerKeyState>
): Prisma.CommunitySetupParameterAggregationCreateManyInput[] {
  const rows: Prisma.CommunitySetupParameterAggregationCreateManyInput[] = [];
  rowsFromPerKeyMapShared(keyMap, (input) => {
    rows.push({
      setupSheetTemplate,
      trackSurface,
      gripLevel,
      parameterKey: input.parameterKey,
      valueType: input.valueType,
      sampleCount: input.sampleCount,
      numericStatsJson: input.numericStatsJson,
      categoricalStatsJson: input.categoricalStatsJson,
    });
  });
  return rows;
}

export function filterTuningKeysOnly(data: Record<string, SetupSnapshotValue>): Record<string, SetupSnapshotValue> {
  const out: Record<string, SetupSnapshotValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (isTuningComparisonKey(k)) out[k] = v;
  }
  return out;
}
