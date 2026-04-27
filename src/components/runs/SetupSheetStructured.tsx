"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";
import {
  coerceSetupValue,
  type PresetWithOtherValue,
  type SetupSnapshotData,
  type SetupSnapshotValue,
} from "@/lib/runSetup";
import type { StructuredRow, StructuredSection } from "@/lib/a800rrSetupDisplayConfig";
import {
  formatBoolDisplay,
  formatMultiDisplay,
  getBoolFromSetupString,
  rawField,
  readPresetWithOtherDisplay,
  readSetupField,
  readSetupScrewSelection,
  topDeckRenderMode,
} from "@/lib/a800rrSetupRead";
import {
  companionOtherTextKeyForSingleSelect,
  getCalibrationFieldKind,
  getSingleSelectChipOptions,
  getVisualMultiOptions,
} from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { AwesomatixScrewStrip } from "@/components/setup-sheet/AwesomatixScrewStrip";
import { compareSetupField, maxSeverity } from "@/lib/setupCompare/compare";
import {
  compareResultToHighlight,
  type CompareColumnRole,
} from "@/lib/setupCompare/compareHighlight";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import type { FieldCompareResult } from "@/lib/setupCompare/types";
import {
  DERIVED_FRONT_SPRING_RATE_KEY,
  DERIVED_REAR_SPRING_RATE_KEY,
  isDerivedSetupKey,
} from "@/lib/setupCalculations/a800rrDerived";
import {
  computeSpringRateLookupForSide,
  hintForSpringLookup,
  type SpringLookupResolutionCode,
} from "@/lib/setupCalculations/springRateLookup";
import {
  displayPresetWithOther,
  getPresetWithOtherFromData,
  isEmptyPresetWithOther,
  isPresetWithOtherFieldKey,
  normalizePresetWithOtherFromUnknown,
} from "@/lib/setup/presetWithOther";

/** Avoid hard-crash if formatter is missing (bundler/circular edge cases). */
function displayMultiForCompare(raw: string): string {
  if (typeof formatMultiDisplay === "function") return formatMultiDisplay(raw);
  if (!raw.trim()) return "—";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

type Props = {
  sections: StructuredSection[];
  value: SetupSnapshotData;
  onChange: (next: SetupSnapshotData) => void;
  readOnly: boolean;
  baselineValue: SetupSnapshotData | null;
  highlightChangedKeys: Set<string> | null;
  /** Car aggregation numeric stats: IQR scale for comparison gradient only. */
  numericAggregationByKey?: ReadonlyMap<string, NumericAggregationCompareSlice> | null;
  /** Search + jump to field rows (edit flows). */
  enableFieldSearch?: boolean;
  /**
   * Setup compare side-by-side: value column only uses A=blue / B=red tints; labels stay neutral.
   * Omit everywhere except the two Setup compare panels.
   */
  compareValueColumnRole?: CompareColumnRole | null;
};

/** Keys and labels for “find field” (mirrors row rendering, including top deck block). */
function collectFieldSearchEntries(sections: StructuredSection[]): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const sec of sections) {
    for (const row of sec.rows) {
      if (row.type === "single") {
        out.push({ key: row.key, label: row.label });
      } else if (row.type === "pair") {
        out.push({ key: row.leftKey, label: `${row.label} · Front` });
        out.push({ key: row.rightKey, label: `${row.label} · Rear` });
      } else if (row.type === "corner4") {
        const corners: { k: string; lab: string }[] = [
          { k: row.ff, lab: "FF" },
          { k: row.fr, lab: "FR" },
          { k: row.rf, lab: "RF" },
          { k: row.rr, lab: "RR" },
        ];
        for (const { k, lab } of corners) {
          out.push({ key: k, label: `${row.label} · ${lab}` });
        }
      } else if (row.type === "top_deck_block") {
        out.push({ key: "top_deck_front", label: "Top deck · Front" });
        out.push({ key: "top_deck_rear", label: "Top deck · Rear" });
        out.push({ key: "top_deck_cuts", label: "Top deck cuts" });
        out.push({ key: "top_deck_single", label: "Top deck · Single" });
      } else if (row.type === "screw_strip") {
        out.push({ key: row.key, label: row.label });
      }
    }
  }
  return out;
}

function SetupFieldJumpSearch({
  entries,
  rootRef,
}: {
  entries: readonly { key: string; label: string }[];
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return entries.filter(
      (e) => e.label.toLowerCase().includes(s) || e.key.toLowerCase().includes(s)
    );
  }, [entries, q]);

  const jumpTo = (key: string) => {
    const root = rootRef.current;
    if (!root || typeof CSS === "undefined" || typeof CSS.escape !== "function") return;
    const el = root.querySelector(`[data-setup-field-key="${CSS.escape(key)}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("ring-2", "ring-accent/70", "rounded-sm");
    window.setTimeout(() => {
      el.classList.remove("ring-2", "ring-accent/70", "rounded-sm");
    }, 1400);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative mb-3">
      <label htmlFor="setup-field-search" className="sr-only">
        Find setup field
      </label>
      <input
        id="setup-field-search"
        type="search"
        autoComplete="off"
        placeholder="Find field…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 180)}
        className="w-full max-w-md rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-accent/50"
      />
      {open && filtered.length > 0 ? (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full max-w-md overflow-auto rounded-md border border-border bg-card py-1 text-xs shadow-md"
          role="listbox"
        >
          {filtered.slice(0, 50).map((e) => (
            <li key={e.key} role="option">
              <button
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-muted/80"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  jumpTo(e.key);
                }}
              >
                <span className="font-medium text-foreground">{e.label}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{e.key}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatDerivedSpringRateNumber(n: number): string {
  return n.toFixed(3);
}

function shortSpringRateMissingReason(code: SpringLookupResolutionCode): string {
  switch (code) {
    case "missing_input_value":
      return "Missing inputs";
    case "missing_input_mapping":
      return "Cannot map spring/SRS";
    case "unsupported_lookup_value":
      return "Gap out of range";
    case "lookup_missing":
      return "No table entry";
    default:
      return "—";
  }
}

/** Full hint for tooltip when lookup did not produce a rate. */
function springRateFieldTooltip(data: SetupSnapshotData, key: string): string | undefined {
  if (key !== DERIVED_FRONT_SPRING_RATE_KEY && key !== DERIVED_REAR_SPRING_RATE_KEY) return undefined;
  const side = key === DERIVED_FRONT_SPRING_RATE_KEY ? "front" : "rear";
  const sideLabel = side === "front" ? "Front" : "Rear";
  const { rate, resolution, input } = computeSpringRateLookupForSide(data, side);
  if (rate != null) return undefined;
  const h = hintForSpringLookup(sideLabel, input, resolution);
  return h.trim() || undefined;
}

function fieldValue(data: SetupSnapshotData, key: string): string {
  if (key === DERIVED_FRONT_SPRING_RATE_KEY || key === DERIVED_REAR_SPRING_RATE_KEY) {
    const direct = rawField(data, key);
    if (direct !== "") {
      const n = Number(String(direct).replace(",", "."));
      if (Number.isFinite(n)) return formatDerivedSpringRateNumber(n);
      return direct;
    }
    const side = key === DERIVED_FRONT_SPRING_RATE_KEY ? "front" : "rear";
    const { rate, resolution } = computeSpringRateLookupForSide(data, side);
    if (rate != null) return formatDerivedSpringRateNumber(rate);
    return shortSpringRateMissingReason(resolution);
  }
  if (isPresetWithOtherFieldKey(key)) {
    return readPresetWithOtherDisplay(data, key);
  }
  const otherK = companionOtherTextKeyForSingleSelect(key);
  if (otherK) {
    const ot = rawField(data, otherK);
    if (ot.trim()) return ot.trim();
  }
  return readSetupField(data, key);
}

function mergeFieldCompareResults(a: FieldCompareResult, b: FieldCompareResult): FieldCompareResult {
  const areEqual = a.areEqual && b.areEqual;
  if (areEqual) {
    return {
      key: a.key,
      areEqual: true,
      severity: "same",
      severityReason: `${a.severityReason} · ${b.severityReason}`,
      normalizedA: a.normalizedA,
      normalizedB: a.normalizedB,
    };
  }
  const severity = maxSeverity([a.severity, b.severity]);
  const ga = a.gradientIntensity ?? 0;
  const gb = b.gradientIntensity ?? 0;
  const g = Math.max(ga, gb);
  return {
    key: a.key,
    areEqual: false,
    severity,
    severityReason: `${a.severityReason} · ${b.severityReason}`,
    normalizedA: a.normalizedA,
    normalizedB: a.normalizedB,
    gradientIntensity: g > 0 ? g : undefined,
  };
}

function keyFieldCompareResult(
  key: string,
  value: SetupSnapshotData,
  baseline: SetupSnapshotData | null,
  highlightChangedKeys: Set<string> | null,
  numericAggregationByKey: ReadonlyMap<string, NumericAggregationCompareSlice> | null | undefined
): FieldCompareResult {
  const aggMap = numericAggregationByKey ?? null;
  if (!baseline) {
    return {
      key,
      areEqual: true,
      severity: "same",
      severityReason: "no baseline",
      normalizedA: "—",
      normalizedB: "—",
    };
  }
  if (highlightChangedKeys?.has(key)) {
    const base = compareSetupField({ key, a: value[key], b: baseline[key], numericAggregationByKey: aggMap });
    return {
      ...base,
      areEqual: false,
      severity: "major",
      severityReason: "forced highlight",
      gradientIntensity: 1,
    };
  }
  const main = compareSetupField({ key, a: value[key], b: baseline[key], numericAggregationByKey: aggMap });
  const co = companionOtherTextKeyForSingleSelect(key);
  if (!co) return main;
  const other = compareSetupField({ key: co, a: value[co], b: baseline[co], numericAggregationByKey: aggMap });
  return mergeFieldCompareResults(main, other);
}

/** Safe string for inline labels — never pass raw snapshot objects into JSX text. */
function coerceSetupSheetDisplayString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("otherText" in o || "selectedPreset" in o) {
      const pov = normalizePresetWithOtherFromUnknown(o, undefined, null);
      return displayPresetWithOther(pov);
    }
  }
  return "";
}

function InlineValueCompare({
  value: valueRaw,
  baseline: baselineRaw,
  hasBaseline,
  fieldKind,
  title,
}: {
  value: unknown;
  baseline: unknown;
  hasBaseline: boolean;
  fieldKind?: "text" | "bool" | "multi";
  title?: string;
}) {
  const value = coerceSetupSheetDisplayString(valueRaw);
  const baseline = coerceSetupSheetDisplayString(baselineRaw);
  const kind = fieldKind ?? "text";
  const display = (s: string) => {
    if (s === "") return "—";
    if (kind === "bool") return formatBoolDisplay(s);
    if (kind === "multi") return displayMultiForCompare(s);
    return s;
  };
  const pv = display(value);
  const bv = display(baseline);
  const showVs =
    hasBaseline &&
    baseline !== undefined &&
    value !== baseline &&
    !(value === "" && baseline === "");

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0" title={title}>
      <span className="text-sm font-sans tabular-nums font-semibold text-foreground">{pv}</span>
      {showVs ? (
        <>
          <span className="text-muted-foreground select-none">·</span>
          <span className="text-sm font-sans tabular-nums font-semibold text-muted-foreground">vs {bv}</span>
        </>
      ) : null}
    </div>
  );
}

function normalizeOptionToken(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchesAnyPreset(value: string, options: string[]): boolean {
  const v = normalizeOptionToken(value);
  return options.some((o) => normalizeOptionToken(o) === v);
}

/** When "Other" exists in options, show free-text as primary if value is not exactly one of the presets. */
function primaryDisplayForChipField(value: string, options: string[]): string | null {
  if (!value.trim()) return null;
  if (matchesAnyPreset(value, options)) return null;
  const otherOpt = options.find((o) => normalizeOptionToken(o) === "other");
  if (!otherOpt) return null;
  return value.trim();
}

function fieldOptionsForKey(key: string): { options: string[]; multi: boolean } | null {
  const multi = getVisualMultiOptions(key);
  if (multi && multi.length > 0) return { options: multi, multi: true };
  const single = getSingleSelectChipOptions(key);
  if (single && single.length > 0) return { options: single, multi: false };
  const kind = getCalibrationFieldKind(key);
  if (kind === "boolean") return { options: ["yes", "no"], multi: false };
  return null;
}

/**
 * Which preset chip is selected. When `mapFreeTextToOtherChip` is false (preset + separate otherText),
 * unmatched text must not pretend to select an "Other" chip — other is not part of the chip group.
 */
function selectedOptionForValue(
  rawValue: string,
  options: string[],
  mapFreeTextToOtherChip = true
): string | null {
  const raw = typeof rawValue === "string" ? rawValue : "";
  const isBool =
    options.length === 2
    && options.some((o) => normalizeOptionToken(o) === "yes")
    && options.some((o) => normalizeOptionToken(o) === "no");
  if (isBool) return getBoolFromSetupString(raw) ? "yes" : "no";
  const v = normalizeOptionToken(raw);
  if (!v) return null;
  for (const opt of options) {
    if (normalizeOptionToken(opt) === v) return opt;
  }
  if (!mapFreeTextToOtherChip) return null;
  const otherOpt = options.find((o) => normalizeOptionToken(o) === "other");
  if (otherOpt && v) return otherOpt;
  return null;
}

function selectedOptionsForValue(rawValue: string, options: string[]): Set<string> {
  const tokens = rawValue
    .split(/[,;/+|]|\s+/)
    .map((s) => normalizeOptionToken(s))
    .filter(Boolean);
  const tokenSet = new Set(tokens);
  const out = new Set<string>();
  for (const opt of options) {
    if (tokenSet.has(normalizeOptionToken(opt))) out.add(opt);
  }
  return out;
}

function commitOptionValue(option: string, options: string[]): string {
  const isBool =
    options.length === 2
    && options.some((o) => normalizeOptionToken(o) === "yes")
    && options.some((o) => normalizeOptionToken(o) === "no");
  if (isBool) return normalizeOptionToken(option) === "yes" ? "1" : "";
  return option;
}

function toggleOptionSelection(current: string, option: string, options: string[]): string[] {
  const selected = selectedOptionsForValue(current, options);
  if (selected.has(option)) selected.delete(option);
  else selected.add(option);
  return options.filter((o) => selected.has(o));
}

function OptionSquareFieldDisplay({
  value,
  presetValue,
  hasCompanionOther,
  baseline,
  options,
  multi,
  readOnly,
  onSelect,
  chipAccent = "sky",
}: {
  value: string;
  /** When set, chip selection uses this instead of `value` (preset token on canonical key). */
  presetValue?: string;
  /** When true, skip legacy single-string "Other" free-text line (use `{key}_other` instead). */
  hasCompanionOther?: boolean;
  baseline: string;
  options: string[];
  multi: boolean;
  readOnly: boolean;
  /** `null` = clear single-select (click same chip again). Multi-select always passes the option. */
  onSelect?: (opt: string | null) => void;
  /** Setup A vs B compare: sky = column A, rose = column B. */
  chipAccent?: "sky" | "rose";
}) {
  // Preset + free-text: highlight chips only from selectedPreset, never from otherText / display string.
  const chipSource = hasCompanionOther
    ? (typeof presetValue === "string" ? presetValue.trim() : "")
    : presetValue != null && presetValue !== ""
      ? presetValue
      : value;
  const selected = multi
    ? null
    : selectedOptionForValue(chipSource, options, !hasCompanionOther);
  const valueStr = typeof value === "string" ? value : coerceSetupSheetDisplayString(value);
  const valueForMulti = valueStr;
  const selectedMulti = multi ? selectedOptionsForValue(valueForMulti, options) : null;
  const primaryExtra =
    !multi && !hasCompanionOther ? primaryDisplayForChipField(valueStr, options) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {options.map((opt) => {
          const isSelected = multi
            ? Boolean(selectedMulti?.has(opt))
            : (selected != null && normalizeOptionToken(selected) === normalizeOptionToken(opt));
          const selectedChip =
            chipAccent === "rose"
              ? "border-rose-500/90 bg-rose-500/25 text-foreground"
              : "border-sky-500/90 bg-sky-500/25 text-foreground";
          return (
            <button
              key={opt}
              type="button"
              disabled={readOnly}
              onClick={() => {
                if (multi) onSelect?.(opt);
                else if (isSelected) onSelect?.(null);
                else onSelect?.(opt);
              }}
              className={cn(
                "rounded border px-2 py-1 text-[11px] font-sans tabular-nums font-semibold transition-colors",
                isSelected ? selectedChip : "border-border bg-muted/40 text-muted-foreground",
                !readOnly && "hover:bg-muted/70",
                readOnly && "cursor-default"
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {primaryExtra ? (
        <span className="text-sm font-sans tabular-nums font-semibold text-foreground break-all">{primaryExtra}</span>
      ) : null}
    </div>
  );
}

function PresetWithOtherChipEditor({
  fieldKey,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  options,
  chipAccent = "sky",
}: {
  fieldKey: string;
  value: SetupSnapshotData;
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  readOnly: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  options: string[];
  chipAccent?: "sky" | "rose";
}) {
  const catalogOpts = getSingleSelectChipOptions(fieldKey);
  const title = springRateFieldTooltip(value, fieldKey);
  const pov = getPresetWithOtherFromData(value as Record<string, unknown>, fieldKey, catalogOpts);
  const basePov = baseline
    ? getPresetWithOtherFromData(baseline as Record<string, unknown>, fieldKey, catalogOpts)
    : { selectedPreset: "", otherText: "" };
  const presetRaw = pov.selectedPreset;
  const otherRaw = pov.otherText;
  const v = displayPresetWithOther(pov);
  const b = displayPresetWithOther(basePov);

  const [localOther, setLocalOther] = useState(otherRaw);
  const [otherFocused, setOtherFocused] = useState(false);
  const otherInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!otherFocused) setLocalOther(otherRaw);
  }, [otherRaw, otherFocused]);

  const chipBlock = (
    <OptionSquareFieldDisplay
      value={v}
      presetValue={presetRaw}
      hasCompanionOther
      baseline={b}
      options={options}
      multi={false}
      readOnly={readOnly}
      chipAccent={chipAccent}
      onSelect={(opt) => {
        if (opt === null) {
          onCommit(fieldKey, {
            selectedPreset: "",
            otherText: otherFocused ? localOther : otherRaw,
          });
          return;
        }
        const next: PresetWithOtherValue = {
          selectedPreset: commitOptionValue(opt, options),
          otherText: otherFocused ? localOther : otherRaw,
        };
        onCommit(fieldKey, next);
      }}
    />
  );

  const otherInput = (
    <input
      ref={otherInputRef}
      type="text"
      placeholder="Custom / notes (optional)"
      className={cn(
        "mt-1 w-full rounded border border-border/60 bg-muted/20 px-2 py-1 text-xs font-sans tabular-nums font-medium outline-none placeholder:text-muted-foreground/70",
        otherFocused && "bg-card ring-1 ring-accent/40",
        readOnly && "cursor-default border-transparent bg-transparent opacity-90"
      )}
      value={otherFocused ? localOther : otherRaw}
      readOnly={readOnly}
      onFocus={() => {
        if (readOnly) return;
        setOtherFocused(true);
        setLocalOther(otherRaw);
      }}
      onBlur={() => {
        setOtherFocused(false);
        const latest = getPresetWithOtherFromData(value as Record<string, unknown>, fieldKey, catalogOpts);
        onCommit(fieldKey, { selectedPreset: latest.selectedPreset, otherText: localOther });
      }}
      onChange={(e) => setLocalOther(e.target.value)}
      aria-label={`${fieldKey} custom text`}
    />
  );

  if (readOnly) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <InlineValueCompare value={v} baseline={b} hasBaseline={hasBaseline} fieldKind="text" title={title} />
        <div className="min-w-0">{chipBlock}</div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {chipBlock}
      {otherInput}
    </div>
  );
}

/** Legacy `{key}` + `{key}_other` companion rows (non-canonical preset+other). */
function LegacyCompanionOtherChipEditor({
  fieldKey,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  options,
  chipAccent = "sky",
}: {
  fieldKey: string;
  value: SetupSnapshotData;
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  readOnly: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  options: string[];
  chipAccent?: "sky" | "rose";
}) {
  const otherK = companionOtherTextKeyForSingleSelect(fieldKey);
  const v = fieldValue(value, fieldKey);
  const b = baseline ? fieldValue(baseline, fieldKey) : "";
  const presetRaw = rawField(value, fieldKey);
  const otherRawLegacy = otherK ? rawField(value, otherK) : "";
  const otherOnly = Boolean(otherK && !presetRaw.trim() && otherRawLegacy.trim());
  const both = Boolean(otherK && presetRaw.trim() && otherRawLegacy.trim());

  const [localOther, setLocalOther] = useState(otherRawLegacy);
  const [otherFocused, setOtherFocused] = useState(false);
  const otherInputRef = useRef<HTMLInputElement>(null);
  const title = springRateFieldTooltip(value, fieldKey);
  useEffect(() => {
    if (!otherFocused) setLocalOther(otherRawLegacy);
  }, [otherRawLegacy, otherFocused]);

  if (!otherK) {
    return (
      <OptionSquareFieldDisplay
        value={v}
        baseline={b}
        options={options}
        multi={false}
        readOnly={readOnly}
        chipAccent={chipAccent}
        onSelect={(opt) => onCommit(fieldKey, opt === null ? "" : commitOptionValue(opt, options))}
      />
    );
  }

  if (otherOnly) {
    if (readOnly) {
      return (
        <InlineValueCompare value={v} baseline={b} hasBaseline={hasBaseline} fieldKind="text" title={title} />
      );
    }
    return (
      <input
        ref={otherInputRef}
        className={cn(
          "w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none",
          otherFocused && "bg-card ring-1 ring-accent/40"
        )}
        value={otherFocused ? localOther : otherRawLegacy}
        onFocus={() => {
          setOtherFocused(true);
          setLocalOther(otherRawLegacy);
        }}
        onBlur={() => {
          setOtherFocused(false);
          onCommit(otherK, localOther);
        }}
        onChange={(e) => setLocalOther(e.target.value)}
        aria-label={`${fieldKey} other`}
      />
    );
  }

  const chipBlockLegacy = (
    <OptionSquareFieldDisplay
      value={v}
      presetValue={presetRaw}
      hasCompanionOther
      baseline={b}
      options={options}
      multi={false}
      readOnly={readOnly}
      chipAccent={chipAccent}
      onSelect={(opt) => onCommit(fieldKey, opt === null ? "" : commitOptionValue(opt, options))}
    />
  );

  if (both) {
    if (readOnly) {
      return (
        <div className="flex min-w-0 flex-col gap-1">
          <InlineValueCompare value={v} baseline={b} hasBaseline={hasBaseline} fieldKind="text" title={title} />
          {chipBlockLegacy}
        </div>
      );
    }
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <input
          ref={otherInputRef}
          className={cn(
            "w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none",
            otherFocused && "bg-card ring-1 ring-accent/40"
          )}
          value={otherFocused ? localOther : otherRawLegacy}
          onFocus={() => {
            setOtherFocused(true);
            setLocalOther(otherRawLegacy);
          }}
          onBlur={() => {
            setOtherFocused(false);
            onCommit(otherK, localOther);
          }}
          onChange={(e) => setLocalOther(e.target.value)}
          aria-label={`${fieldKey} other`}
        />
        {chipBlockLegacy}
      </div>
    );
  }

  return chipBlockLegacy;
}

/**
 * Single-select chip fields with optional free text:
 * - Canonical preset+other fields: `{ selectedPreset, otherText }` on one key (see `presetWithOther.ts`).
 * - Legacy: `{key}_other` companion when catalog still exposes it.
 */
function SingleSelectChipWithOptionalOther(props: {
  fieldKey: string;
  value: SetupSnapshotData;
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  readOnly: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  options: string[];
  chipAccent?: "sky" | "rose";
}) {
  if (isPresetWithOtherFieldKey(props.fieldKey)) {
    return <PresetWithOtherChipEditor {...props} />;
  }
  return <LegacyCompanionOtherChipEditor {...props} />;
}

/** Inline `· vs …` for bool when a separate control already shows the primary Yes/No. */
function BoolCompareTail({
  value,
  baseline,
  hasBaseline,
}: {
  value: string;
  baseline: string;
  hasBaseline: boolean;
}) {
  if (!hasBaseline) return null;
  if (getBoolFromSetupString(value) === getBoolFromSetupString(baseline)) return null;
  const bv = formatBoolDisplay(baseline);
  return (
    <>
      <span className="text-muted-foreground select-none">·</span>
      <span className="text-sm font-sans tabular-nums font-semibold text-muted-foreground">vs {bv}</span>
    </>
  );
}

function EditableSingle({
  fieldKey,
  label,
  unit,
  multiline,
  fieldKind,
  value,
  baseline,
  hasBaseline,
  changed,
  rowHighlight,
  compareColumnRole,
  readOnly,
  onCommit,
}: {
  fieldKey: string;
  label: string;
  unit?: string;
  multiline?: boolean;
  fieldKind?: "text" | "bool" | "multi";
  value: SetupSnapshotData;
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  changed: boolean;
  rowHighlight: { className: string; style?: CSSProperties };
  compareColumnRole?: CompareColumnRole;
  readOnly: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
}) {
  const chipAccent: "sky" | "rose" = compareColumnRole === "b" ? "rose" : "sky";
  const v = fieldValue(value, fieldKey);
  const b = baseline ? fieldValue(baseline, fieldKey) : "";
  const [local, setLocal] = useState(v);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focused) setLocal(v);
  }, [v, focused]);

  const showCompareEdit = hasBaseline && !focused;
  const effectiveReadOnly = readOnly || isDerivedSetupKey(fieldKey);
  const options = fieldOptionsForKey(fieldKey);
  const beginEdit = () => {
    setFocused(true);
    setLocal(v);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      textareaRef.current?.focus();
    });
  };

  if (effectiveReadOnly || fieldKind === "bool") {
    return (
      <div
        data-setup-field-key={fieldKey}
        className="flex min-h-[1.9rem] items-stretch border-b border-border/80 last:border-b-0"
      >
        <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center">
          {label}
          {unit ? <span className="ml-0.5 text-[9px] normal-case opacity-70">({unit})</span> : null}
        </div>
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col justify-center px-2 py-0.5",
            changed && rowHighlight.className
          )}
          style={changed && rowHighlight.style ? rowHighlight.style : undefined}
        >
          {options ? (
            options.multi ? (
              <OptionSquareFieldDisplay
                value={v}
                baseline={b}
                options={options.options}
                multi
                readOnly={effectiveReadOnly}
                chipAccent={chipAccent}
                onSelect={(opt) => {
                  if (opt == null) return;
                  onCommit(fieldKey, toggleOptionSelection(v, opt, options.options));
                }}
              />
            ) : (
              <SingleSelectChipWithOptionalOther
                fieldKey={fieldKey}
                value={value}
                baseline={baseline}
                hasBaseline={hasBaseline}
                readOnly={effectiveReadOnly}
                onCommit={onCommit}
                options={options.options}
                chipAccent={chipAccent}
              />
            )
          ) : fieldKind === "bool" && !effectiveReadOnly ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-md border border-border bg-muted/70 px-2 py-1 text-[11px] font-sans tabular-nums font-semibold",
                  getBoolFromSetupString(v) && "border-accent/60 bg-accent/10"
                )}
                onClick={() => onCommit(fieldKey, getBoolFromSetupString(v) ? "" : "1")}
              >
                {getBoolFromSetupString(v) ? "Yes" : "No"}
              </button>
              <BoolCompareTail value={v} baseline={b} hasBaseline={hasBaseline} />
            </div>
          ) : fieldKind === "multi" ? (
            <InlineValueCompare
              value={v}
              baseline={b}
              hasBaseline={hasBaseline}
              fieldKind="multi"
              title={springRateFieldTooltip(value, fieldKey)}
            />
          ) : (
            <InlineValueCompare
              value={v}
              baseline={b}
              hasBaseline={hasBaseline}
              fieldKind="text"
              title={springRateFieldTooltip(value, fieldKey)}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-setup-field-key={fieldKey}
      className="flex min-h-[1.9rem] items-stretch border-b border-border/80 last:border-b-0"
    >
      <div className="w-[38%] shrink-0 border-r border-border/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center">
        {label}
        {unit ? <span className="ml-0.5 text-[9px] normal-case opacity-70">({unit})</span> : null}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center px-1",
          changed && rowHighlight.className
        )}
        style={changed && rowHighlight.style ? rowHighlight.style : undefined}
      >
        {options ? (
          <div className="px-1 py-1">
            {options.multi ? (
              <OptionSquareFieldDisplay
                value={v}
                baseline={b}
                options={options.options}
                multi
                readOnly={effectiveReadOnly}
                chipAccent={chipAccent}
                onSelect={(opt) => {
                  if (opt == null) return;
                  onCommit(fieldKey, toggleOptionSelection(v, opt, options.options));
                }}
              />
            ) : (
              <SingleSelectChipWithOptionalOther
                fieldKey={fieldKey}
                value={value}
                baseline={baseline}
                hasBaseline={hasBaseline}
                readOnly={effectiveReadOnly}
                onCommit={onCommit}
                options={options.options}
                chipAccent={chipAccent}
              />
            )}
          </div>
        ) : fieldKind === "multi" ? (
          effectiveReadOnly ? (
            <InlineValueCompare
              value={v}
              baseline={b}
              hasBaseline={hasBaseline}
              fieldKind="text"
              title={springRateFieldTooltip(value, fieldKey)}
            />
          ) : focused ? (
            <input
              ref={inputRef}
              className="w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none"
              value={local}
              onBlur={() => {
                setFocused(false);
                onCommit(fieldKey, local);
              }}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Comma-separated…"
            />
          ) : showCompareEdit ? (
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-sm font-sans tabular-nums font-semibold outline-none hover:bg-muted/50"
              onClick={beginEdit}
            >
              <InlineValueCompare
                value={v}
                baseline={b}
                hasBaseline={hasBaseline}
                fieldKind="multi"
                title={springRateFieldTooltip(value, fieldKey)}
              />
            </button>
          ) : (
            <input
              ref={inputRef}
              className="w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none"
              value={local}
              onFocus={() => {
                setFocused(true);
                setLocal(v);
              }}
              onBlur={() => {
                setFocused(false);
                onCommit(fieldKey, local);
              }}
              onChange={(e) => setLocal(e.target.value)}
              placeholder="Comma-separated…"
            />
          )
        ) : multiline ? (
          focused ? (
            <textarea
              ref={textareaRef}
              className={cn(
                "min-h-[2.5rem] w-full resize-y rounded bg-transparent px-2 py-1 text-xs font-sans tabular-nums font-semibold outline-none",
                "bg-card ring-1 ring-accent/40"
              )}
              rows={2}
              value={local}
              onBlur={() => {
                setFocused(false);
                onCommit(fieldKey, local);
              }}
              onChange={(e) => setLocal(e.target.value)}
            />
          ) : showCompareEdit ? (
            <button
              type="button"
              className="w-full rounded px-2 py-1 text-left text-xs font-sans tabular-nums font-semibold outline-none hover:bg-muted/50"
              onClick={beginEdit}
            >
              <InlineValueCompare
                value={v}
                baseline={b}
                hasBaseline={hasBaseline}
                fieldKind="text"
                title={springRateFieldTooltip(value, fieldKey)}
              />
            </button>
          ) : (
            <textarea
              ref={textareaRef}
              className={cn(
                "min-h-[2.5rem] w-full resize-y rounded bg-transparent px-2 py-1 text-xs font-sans tabular-nums font-semibold outline-none",
                focused && "bg-card ring-1 ring-accent/40"
              )}
              rows={2}
              value={focused ? local : v}
              onFocus={() => {
                setFocused(true);
                setLocal(v);
              }}
              onBlur={() => {
                setFocused(false);
                onCommit(fieldKey, local);
              }}
              onChange={(e) => setLocal(e.target.value)}
            />
          )
        ) : focused ? (
          <input
            ref={inputRef}
            className={cn(
              "w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none",
              "bg-card ring-1 ring-accent/40"
            )}
            value={local}
            onBlur={() => {
              setFocused(false);
              onCommit(fieldKey, local);
            }}
            onChange={(e) => setLocal(e.target.value)}
          />
        ) : showCompareEdit ? (
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-sm font-sans tabular-nums font-semibold outline-none hover:bg-muted/50"
            onClick={beginEdit}
          >
            <InlineValueCompare
              value={v}
              baseline={b}
              hasBaseline={hasBaseline}
              fieldKind="text"
              title={springRateFieldTooltip(value, fieldKey)}
            />
          </button>
        ) : (
          <input
            ref={inputRef}
            className={cn(
              "w-full rounded bg-transparent px-2 py-1 text-sm font-sans tabular-nums font-semibold outline-none",
              focused && "bg-card ring-1 ring-accent/40"
            )}
            value={focused ? local : v}
            onFocus={() => {
              setFocused(true);
              setLocal(v);
            }}
            onBlur={() => {
              setFocused(false);
              onCommit(fieldKey, local);
            }}
            onChange={(e) => setLocal(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

function PairSideCell({
  fieldKey,
  side,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  fieldKind,
  highlightChangedKeys,
  numericAggregationByKey,
  compareValueColumnRole,
}: {
  fieldKey: string;
  side: "Front" | "Rear";
  value: SetupSnapshotData;
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  readOnly: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  fieldKind?: "text" | "bool" | "multi";
  highlightChangedKeys: Set<string> | null;
  numericAggregationByKey: ReadonlyMap<string, NumericAggregationCompareSlice> | null | undefined;
  compareValueColumnRole?: CompareColumnRole | null;
}) {
  const v = fieldValue(value, fieldKey);
  const b = baseline ? fieldValue(baseline, fieldKey) : "";
  const cmp = keyFieldCompareResult(fieldKey, value, baseline, highlightChangedKeys, numericAggregationByKey);
  const role = compareValueColumnRole ?? undefined;
  const hl = compareResultToHighlight(cmp, role);
  const chipAccent: "sky" | "rose" = compareValueColumnRole === "b" ? "rose" : "sky";
  const c = !cmp.areEqual;
  const fk = fieldKind ?? "text";
  const [local, setLocal] = useState(v);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setLocal(v);
  }, [v, focused]);

  const showCompareEdit = hasBaseline && !focused;
  const options = fieldOptionsForKey(fieldKey);
  const beginEdit = () => {
    setFocused(true);
    setLocal(v);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (readOnly || fk === "bool") {
    return (
      <div
        data-setup-field-key={fieldKey}
        className={cn(
          "flex min-h-[1.9rem] flex-1 flex-col border-l border-border/60 px-2 py-0.5 first:border-l-0 md:border-border/60",
          c && hl.className
        )}
        style={c && hl.style ? hl.style : undefined}
        aria-label={side}
      >
        <div className="flex min-w-0 flex-col gap-1">
          {options ? (
            options.multi ? (
              <OptionSquareFieldDisplay
                value={v}
                baseline={b}
                options={options.options}
                multi
                readOnly={readOnly}
                chipAccent={chipAccent}
                onSelect={(opt) => {
                  if (opt == null) return;
                  onCommit(fieldKey, toggleOptionSelection(v, opt, options.options));
                }}
              />
            ) : (
              <SingleSelectChipWithOptionalOther
                fieldKey={fieldKey}
                value={value}
                baseline={baseline}
                hasBaseline={hasBaseline}
                readOnly={readOnly}
                onCommit={onCommit}
                options={options.options}
                chipAccent={chipAccent}
              />
            )
          ) : fk === "bool" && !readOnly ? (
            <button
              type="button"
              className={cn(
                "rounded border border-border bg-muted/70 px-1.5 py-0.5 text-[11px] font-sans tabular-nums font-semibold",
                getBoolFromSetupString(v) && "border-accent/60 bg-accent/10"
              )}
              onClick={() => onCommit(fieldKey, getBoolFromSetupString(v) ? "" : "1")}
            >
              {getBoolFromSetupString(v) ? "Yes" : "No"}
            </button>
          ) : (
            <InlineValueCompare
              value={v}
              baseline={b}
              hasBaseline={hasBaseline}
              fieldKind={fk}
              title={springRateFieldTooltip(value, fieldKey)}
            />
          )}
          {fk === "bool" && !readOnly ? (
            <BoolCompareTail value={v} baseline={b} hasBaseline={hasBaseline} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      data-setup-field-key={fieldKey}
      className={cn(
        "flex min-h-[1.9rem] flex-1 flex-col border-l border-border/60 px-2 py-0.5 first:border-l-0 md:border-border/60",
        c && hl.className
      )}
      style={c && hl.style ? hl.style : undefined}
      aria-label={side}
    >
      {options ? (
        <div>
          {options.multi ? (
            <OptionSquareFieldDisplay
              value={v}
              baseline={b}
              options={options.options}
              multi
              readOnly={readOnly}
              chipAccent={chipAccent}
              onSelect={(opt) => {
                if (opt == null) return;
                onCommit(fieldKey, toggleOptionSelection(v, opt, options.options));
              }}
            />
          ) : (
            <SingleSelectChipWithOptionalOther
              fieldKey={fieldKey}
              value={value}
              baseline={baseline}
              hasBaseline={hasBaseline}
              readOnly={readOnly}
              onCommit={onCommit}
              options={options.options}
              chipAccent={chipAccent}
            />
          )}
        </div>
      ) : focused ? (
        <input
          ref={inputRef}
          className={cn(
            "w-full min-w-0 rounded bg-transparent text-sm font-sans tabular-nums font-semibold outline-none",
            "bg-card ring-1 ring-accent/40"
          )}
          value={local}
          onBlur={() => {
            setFocused(false);
            onCommit(fieldKey, local);
          }}
          onChange={(e) => setLocal(e.target.value)}
        />
      ) : showCompareEdit ? (
        <button
          type="button"
          className="w-full min-w-0 rounded px-0 py-0.5 text-left text-sm font-sans tabular-nums font-semibold outline-none hover:bg-muted/40"
          onClick={beginEdit}
        >
          <InlineValueCompare
            value={v}
            baseline={b}
            hasBaseline={hasBaseline}
            fieldKind="text"
            title={springRateFieldTooltip(value, fieldKey)}
          />
        </button>
      ) : (
        <input
          ref={inputRef}
          className={cn(
            "w-full min-w-0 rounded bg-transparent text-sm font-sans tabular-nums font-semibold outline-none",
            focused && "bg-card ring-1 ring-accent/40"
          )}
          value={focused ? local : v}
          onFocus={() => {
            setFocused(true);
            setLocal(v);
          }}
          onBlur={() => {
            setFocused(false);
            onCommit(fieldKey, local);
          }}
          onChange={(e) => setLocal(e.target.value)}
        />
      )}
    </div>
  );
}

function PairRow({
  row,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  highlightChangedKeys,
  numericAggregationByKey,
  compareValueColumnRole,
}: {
  row: Extract<StructuredRow, { type: "pair" }>;
} & Pick<Props, "value" | "readOnly" | "highlightChangedKeys" | "numericAggregationByKey" | "compareValueColumnRole"> & {
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col border-b border-border/80 last:border-b-0 md:flex-row md:items-stretch"
      )}
    >
      <div className="flex w-full shrink-0 items-center border-b border-border/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:w-[38%] md:border-b-0 md:border-r md:border-border/80">
        {row.label}
        {row.unit ? <span className="ml-0.5 text-[9px] normal-case opacity-70">({row.unit})</span> : null}
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x divide-border/60">
        <PairSideCell
          fieldKey={row.leftKey}
          side="Front"
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onCommit={onCommit}
          fieldKind={row.fieldKind}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
        <PairSideCell
          fieldKey={row.rightKey}
          side="Rear"
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onCommit={onCommit}
          fieldKind={row.fieldKind}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
      </div>
    </div>
  );
}

function Corner4Row({
  row,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  highlightChangedKeys,
  numericAggregationByKey,
  compareValueColumnRole,
}: {
  row: Extract<StructuredRow, { type: "corner4" }>;
} & Pick<Props, "value" | "readOnly" | "highlightChangedKeys" | "numericAggregationByKey" | "compareValueColumnRole"> & {
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
}) {
  const role = compareValueColumnRole ?? undefined;
  const sides: { title: "Front" | "Rear"; cells: { k: string; lab: string }[] }[] = [
    { title: "Front", cells: [{ k: row.ff, lab: "FF" }, { k: row.fr, lab: "FR" }] },
    { title: "Rear", cells: [{ k: row.rf, lab: "RF" }, { k: row.rr, lab: "RR" }] },
  ];
  return (
    <div className={cn("flex flex-col border-b border-border/80 last:border-b-0 md:flex-row md:items-stretch")}>
      <div className="flex w-full shrink-0 items-center border-b border-border/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:w-[38%] md:border-b-0 md:border-r md:border-border/80">
        {row.label}
        {row.unit ? <span className="ml-0.5 text-[9px] normal-case opacity-70">({row.unit})</span> : null}
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x divide-border/60">
        {sides.map((side) => (
          <div key={side.title} className="grid grid-cols-2 divide-x divide-border/40" aria-label={side.title}>
            {side.cells.map(({ k, lab }) => {
              const v = fieldValue(value, k);
              const b = baseline ? fieldValue(baseline, k) : "";
              const cornerCmp = keyFieldCompareResult(k, value, baseline, highlightChangedKeys, numericAggregationByKey);
              const cornerHl = compareResultToHighlight(cornerCmp, role);
              const c = !cornerCmp.areEqual;
              return (
                <div
                  key={k}
                  data-setup-field-key={k}
                  className="flex min-h-[1.9rem] min-w-0 items-center gap-1 px-2 py-0.5"
                >
                  <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                    {lab}
                  </span>
                  <div
                    className={cn("min-w-0 flex-1 rounded-sm", c && cornerHl.className)}
                    style={c && cornerHl.style ? cornerHl.style : undefined}
                  >
                    {readOnly ? (
                      <InlineValueCompare
                        value={v}
                        baseline={b}
                        hasBaseline={hasBaseline}
                        fieldKind="text"
                        title={springRateFieldTooltip(value, k)}
                      />
                    ) : (
                      <CornerCell
                        fieldKey={k}
                        value={v}
                        baseline={b}
                        hasBaseline={hasBaseline}
                        onCommit={onCommit}
                        setupSnapshot={value}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function CornerCell({
  fieldKey,
  value,
  baseline,
  hasBaseline,
  onCommit,
  setupSnapshot,
}: {
  fieldKey: string;
  value: string;
  baseline: string;
  hasBaseline: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  setupSnapshot?: SetupSnapshotData;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);

  const showCompareEdit = hasBaseline && !focused;
  const beginEdit = () => {
    setFocused(true);
    setLocal(value);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div>
      {focused ? (
        <input
          ref={inputRef}
          className={cn(
            "w-full min-w-0 rounded bg-transparent text-sm font-sans tabular-nums font-semibold outline-none",
            "bg-card ring-1 ring-accent/40"
          )}
          value={local}
          onBlur={() => {
            setFocused(false);
            onCommit(fieldKey, local);
          }}
          onChange={(e) => setLocal(e.target.value)}
        />
      ) : showCompareEdit ? (
        <button
          type="button"
          className="w-full min-w-0 rounded px-0 py-0.5 text-left text-sm font-sans tabular-nums font-semibold outline-none hover:bg-muted/40"
          onClick={beginEdit}
        >
          <InlineValueCompare
            value={value}
            baseline={baseline}
            hasBaseline={hasBaseline}
            fieldKind="text"
            title={setupSnapshot ? springRateFieldTooltip(setupSnapshot, fieldKey) : undefined}
          />
        </button>
      ) : (
        <input
          ref={inputRef}
          className={cn(
            "w-full min-w-0 rounded bg-transparent text-sm font-sans tabular-nums font-semibold outline-none",
            focused && "bg-card ring-1 ring-accent/40"
          )}
          value={focused ? local : value}
          onFocus={() => {
            setFocused(true);
            setLocal(value);
          }}
          onBlur={() => {
            setFocused(false);
            onCommit(fieldKey, local);
          }}
          onChange={(e) => setLocal(e.target.value)}
        />
      )}
    </div>
  );
}

function ScrewStripRow({
  row,
  value,
  baseline,
  hasBaseline,
  readOnly,
  onScrewChange,
  highlightChangedKeys,
  numericAggregationByKey,
  compareValueColumnRole,
}: {
  row: Extract<StructuredRow, { type: "screw_strip" }>;
} & Pick<Props, "value" | "readOnly" | "highlightChangedKeys" | "numericAggregationByKey" | "compareValueColumnRole"> & {
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  onScrewChange: (key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts", next: string[]) => void;
}) {
  const variant =
    row.key === "motor_mount_screws"
      ? "motor_mount"
      : row.key === "top_deck_cuts"
        ? "top_deck_cuts"
        : "top_deck";
  const sel = readSetupScrewSelection(value, row.key);
  const baseSel = baseline ? readSetupScrewSelection(baseline, row.key) : [];
  const screwCmp = keyFieldCompareResult(row.key, value, baseline, highlightChangedKeys, numericAggregationByKey);
  const screwHl = compareResultToHighlight(screwCmp, compareValueColumnRole ?? undefined);
  const screwChanged = !screwCmp.areEqual;

  return (
    <div
      data-setup-field-key={row.key}
      className={cn(
        "flex flex-col border-b border-border/80 last:border-b-0 md:flex-row md:items-stretch"
      )}
    >
      <div className="flex w-full shrink-0 items-center border-b border-border/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:w-[38%] md:border-b-0 md:border-r md:border-border/80">
        {row.label}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col justify-center px-2 py-1",
          screwChanged && screwHl.className
        )}
        style={screwChanged && screwHl.style ? screwHl.style : undefined}
      >
        <AwesomatixScrewStrip
          variant={variant}
          selected={sel}
          readOnly={readOnly}
          baselineSelected={baseSel}
          hasBaseline={hasBaseline}
          onChange={readOnly ? undefined : (next) => onScrewChange(row.key, next)}
        />
      </div>
    </div>
  );
}

function TopDeckBlock({
  value,
  baseline,
  hasBaseline,
  readOnly,
  onCommit,
  onScrewChange,
  highlightChangedKeys,
  numericAggregationByKey,
  compareValueColumnRole,
}: Pick<Props, "value" | "readOnly" | "highlightChangedKeys" | "numericAggregationByKey" | "compareValueColumnRole"> & {
  baseline: SetupSnapshotData | null;
  hasBaseline: boolean;
  onCommit: (key: string, raw: SetupSnapshotValue) => void;
  onScrewChange: (key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts", next: string[]) => void;
}) {
  const modeCurrent = topDeckRenderMode(value);
  const modeBaseline = baseline ? topDeckRenderMode(baseline) : "unknown";
  const topDeckSingleCmp = keyFieldCompareResult(
    "top_deck_single",
    value,
    baseline,
    highlightChangedKeys,
    numericAggregationByKey
  );

  return (
    <div className={cn("space-y-0 border-b border-border/80 last:border-b-0")}>
      <PairRow
        row={{
          type: "pair",
          label: "Top deck",
          leftKey: "top_deck_front",
          rightKey: "top_deck_rear",
        }}
        value={value}
        baseline={baseline}
        hasBaseline={hasBaseline}
        readOnly={readOnly}
        onCommit={onCommit}
        highlightChangedKeys={highlightChangedKeys}
        numericAggregationByKey={numericAggregationByKey}
        compareValueColumnRole={compareValueColumnRole}
      />
      <ScrewStripRow
        row={{ type: "screw_strip", key: "top_deck_cuts", label: "Top deck cuts" }}
        value={value}
        baseline={baseline}
        hasBaseline={hasBaseline}
        readOnly={readOnly}
        onScrewChange={onScrewChange}
        highlightChangedKeys={highlightChangedKeys}
        numericAggregationByKey={numericAggregationByKey}
        compareValueColumnRole={compareValueColumnRole}
      />
      <EditableSingle
        fieldKey="top_deck_single"
        label="Top deck · Single"
        value={value}
        baseline={baseline}
        hasBaseline={!!hasBaseline}
        changed={!topDeckSingleCmp.areEqual}
        rowHighlight={compareResultToHighlight(topDeckSingleCmp, compareValueColumnRole ?? undefined)}
        compareColumnRole={compareValueColumnRole ?? undefined}
        readOnly={readOnly}
        onCommit={onCommit}
      />
      {hasBaseline && modeCurrent !== modeBaseline && modeCurrent !== "unknown" && modeBaseline !== "unknown" ? (
        <p className="px-2 py-1 text-[10px] text-muted-foreground">
          Compared run: top deck layout is {modeBaseline} · this run: {modeCurrent}
        </p>
      ) : null}
    </div>
  );
}

/** Section has at least one Front/Rear pair-style row → render a column header. */
function sectionHasPairs(rows: readonly StructuredRow[]): boolean {
  return rows.some(
    (r) => r.type === "pair" || r.type === "corner4" || r.type === "top_deck_block" || r.type === "screw_strip"
  );
}

function SectionCard({
  title,
  children,
  showFrontRearHeader,
}: {
  title: string;
  children: React.ReactNode;
  showFrontRearHeader: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/40">
      <div className="border-b border-border bg-card/80 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {showFrontRearHeader ? (
        <div className="hidden border-b border-border/70 bg-card/40 text-[10px] font-medium uppercase tracking-wide text-muted-foreground md:flex">
          <div className="w-[38%] shrink-0 border-r border-border/60 px-2 py-1">Parameter</div>
          <div className="grid flex-1 grid-cols-2 divide-x divide-border/60">
            <div className="px-2 py-1">Front</div>
            <div className="px-2 py-1">Rear</div>
          </div>
        </div>
      ) : null}
      <div className="divide-y divide-border/30">{children}</div>
    </div>
  );
}

export function SetupSheetStructured({
  sections,
  value,
  onChange,
  readOnly,
  baselineValue,
  highlightChangedKeys,
  numericAggregationByKey = null,
  enableFieldSearch = false,
  compareValueColumnRole = null,
}: Props) {
  const baseline = baselineValue ?? null;
  const hasBaseline = baseline != null;
  const compareRole = compareValueColumnRole ?? undefined;
  const sheetRootRef = useRef<HTMLDivElement>(null);
  const fieldSearchEntries = useMemo(() => collectFieldSearchEntries(sections), [sections]);

  const commit = useCallback(
    (key: string, raw: SetupSnapshotValue) => {
      if (isDerivedSetupKey(key)) return;
      if (isPresetWithOtherFieldKey(key)) {
        const opts = getSingleSelectChipOptions(key);
        const next = normalizePresetWithOtherFromUnknown(raw, undefined, opts);
        const nextData = { ...value };
        if (isEmptyPresetWithOther(next)) delete nextData[key];
        else nextData[key] = next;
        onChange(nextData);
        return;
      }
      const nextValue = Array.isArray(raw) ? raw : coerceSetupValue(String(raw ?? ""));
      onChange({ ...value, [key]: nextValue });
    },
    [value, onChange]
  );

  const commitScrews = useCallback(
    (key: "motor_mount_screws" | "top_deck_screws" | "top_deck_cuts", next: string[]) => {
      const nextData = { ...value };
      if (next.length === 0) delete nextData[key];
      else nextData[key] = next;
      onChange(nextData);
    },
    [value, onChange]
  );

  const renderRow = (row: StructuredRow) => {
    if (row.type === "single") {
      const cmp = keyFieldCompareResult(row.key, value, baseline, highlightChangedKeys, numericAggregationByKey);
      const rowHl = compareResultToHighlight(cmp, compareRole);
      return (
        <EditableSingle
          key={row.key}
          fieldKey={row.key}
          label={row.label}
          unit={row.unit}
          multiline={row.multiline}
          fieldKind={row.fieldKind}
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          changed={!cmp.areEqual}
          rowHighlight={rowHl}
          compareColumnRole={compareRole}
          readOnly={readOnly}
          onCommit={commit}
        />
      );
    }
    if (row.type === "pair") {
      return (
        <PairRow
          key={`${row.leftKey}-${row.rightKey}`}
          row={row}
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onCommit={commit}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
      );
    }
    if (row.type === "corner4") {
      return (
        <Corner4Row
          key={`${row.ff}-${row.rr}`}
          row={row}
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onCommit={commit}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
      );
    }
    if (row.type === "top_deck_block") {
      return (
        <TopDeckBlock
          key="topdeck"
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onCommit={commit}
          onScrewChange={commitScrews}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
      );
    }
    if (row.type === "screw_strip") {
      return (
        <ScrewStripRow
          key={row.key}
          row={row}
          value={value}
          baseline={baseline}
          hasBaseline={hasBaseline}
          readOnly={readOnly}
          onScrewChange={commitScrews}
          highlightChangedKeys={highlightChangedKeys}
          numericAggregationByKey={numericAggregationByKey}
          compareValueColumnRole={compareValueColumnRole}
        />
      );
    }
    return null;
  };

  return (
    <div ref={sheetRootRef} className="space-y-3">
      {enableFieldSearch && !readOnly ? (
        <SetupFieldJumpSearch entries={fieldSearchEntries} rootRef={sheetRootRef} />
      ) : null}
      {sections.map((sec) => (
        <SectionCard key={sec.id} title={sec.title} showFrontRearHeader={sectionHasPairs(sec.rows)}>
          {sec.rows.map((row) => renderRow(row))}
        </SectionCard>
      ))}
    </div>
  );
}
