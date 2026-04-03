export type CompareSeverity = "same" | "minor" | "moderate" | "major" | "unknown";

export type FieldCompareResult = {
  key: string;
  areEqual: boolean;
  severity: CompareSeverity;
  severityReason: string;
  normalizedA: string;
  normalizedB: string;
  /** 0–1 heat for configured numeric fields; omitted when equal or non-gradient fallback. */
  gradientIntensity?: number;
};

export type FieldKind = "number" | "categorical" | "boolean" | "multiSelect" | "text";

export type FieldMeta = {
  key: string;
  label: string;
  kind: FieldKind;
  /** Temporary thresholds until population stats are added. */
  thresholds?: { minor?: number; moderate?: number };
};

