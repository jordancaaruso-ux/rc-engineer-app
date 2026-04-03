"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { readSetupField } from "@/lib/a800rrSetupRead";
import { coerceSetupValue, type SetupSnapshotData } from "@/lib/runSetup";
import {
  getDefaultSetupSheetTemplate,
  type SetupSheetFieldDef,
  type SetupSheetTemplate,
} from "@/lib/setupSheetTemplate";
import { SetupSheetStructured } from "@/components/runs/SetupSheetStructured";
import type { NumericAggregationCompareSlice } from "@/lib/setupCompare/numericAggregationCompare";
import { getDifferenceColor } from "@/lib/setupCompare/differenceColor";

export type SetupSheetViewProps = {
  value: SetupSnapshotData;
  onChange: (next: SetupSnapshotData) => void;
  /** When true, show values only (no inputs). Used in Analysis setup view. */
  readOnly?: boolean;
  /** Highlight keys that differ from baseline (compare mode). */
  highlightChangedKeys?: Set<string> | null;
  /** Second setup for comparison; shows "vs X" and highlights changes. */
  baselineValue?: SetupSnapshotData | null;
  className?: string;
  /** Override default generic template (future: car-specific). */
  template?: SetupSheetTemplate;
  /** Optional car aggregation stats for IQR-scaled compare gradient. */
  numericAggregationByKey?: ReadonlyMap<string, NumericAggregationCompareSlice> | null;
};

function fieldValue(v: SetupSnapshotData, key: string): string {
  return readSetupField(v, key);
}

function getBoolFromSetupString(v: string): boolean {
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function SheetCell({
  field,
  value,
  baseline,
  changed,
  onCommit,
  readOnly,
}: {
  field: SetupSheetFieldDef;
  value: string;
  baseline: string;
  changed: boolean;
  onCommit: (key: string, raw: string) => void;
  readOnly?: boolean;
}) {
  const [local, setLocal] = useState(value);
  const [focused, setFocused] = useState(false);
  const editable = !readOnly && field.editable !== false;
  const multiline =
    field.key === "tires_setup" ||
    field.key === "body_notes" ||
    field.key === "notes" ||
    field.key.endsWith("_notes") ||
    field.key.endsWith("_settings");

  useEffect(() => {
    if (!focused) setLocal(value);
  }, [value, focused]);

  const changedStyle: CSSProperties | undefined = changed
    ? {
        backgroundColor: getDifferenceColor(0.6),
        borderLeftWidth: 3,
        borderLeftStyle: "solid",
        borderLeftColor: "rgba(255, 0, 0, 0.45)",
      }
    : undefined;

  return (
    <div
      className={cn("flex items-stretch border-b border-border last:border-b-0 min-h-[2.25rem]")}
      style={changedStyle}
    >
      <div className="w-[38%] shrink-0 px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide border-r border-border/80 flex items-center">
        {field.label}
        {field.unit ? <span className="text-[9px] normal-case ml-0.5 opacity-70">({field.unit})</span> : null}
      </div>
      <div className="flex-1 min-w-0 flex flex-col justify-center px-1">
        {editable ? field.input === "checkbox" ? (
          <div className="flex items-center gap-2 px-2 py-1">
            <button
              type="button"
              className={cn(
                "rounded-md border border-border bg-muted/70 px-2 py-1 text-[11px] font-mono hover:bg-muted/70 transition",
                getBoolFromSetupString(value) && "border-accent/60 bg-accent/10"
              )}
              aria-pressed={getBoolFromSetupString(value)}
              onClick={() => {
                const nextChecked = !getBoolFromSetupString(value);
                onCommit(field.key, nextChecked ? "1" : "");
              }}
            >
              {getBoolFromSetupString(value) ? "On" : "Off"}
            </button>
            <span className="text-[10px] font-medium text-muted-foreground">toggle</span>
          </div>
        ) : multiline ? (
          <textarea
            className={cn(
              "w-full min-h-[2.5rem] resize-y bg-transparent px-2 py-1 text-xs font-mono outline-none rounded",
              focused && "ring-1 ring-accent/50 bg-card"
            )}
            placeholder="—"
            rows={2}
            value={focused ? local : value}
            onFocus={() => {
              setFocused(true);
              setLocal(value);
            }}
            onBlur={() => {
              setFocused(false);
              onCommit(field.key, local);
            }}
            onChange={(e) => setLocal(e.target.value)}
            aria-label={field.label}
          />
        ) : (
          <input
            className={cn(
              "w-full bg-transparent px-2 py-1 text-sm font-mono outline-none rounded",
              focused && "ring-1 ring-accent/50 bg-card"
            )}
            inputMode="decimal"
            placeholder="—"
            value={focused ? local : value}
            onFocus={() => {
              setFocused(true);
              setLocal(value);
            }}
            onBlur={() => {
              setFocused(false);
              onCommit(field.key, local);
            }}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label={field.label}
          />
        ) : (
          <span className="px-2 py-1 text-sm font-mono text-muted-foreground">{value || "—"}</span>
        )}
        {baseline !== "" && baseline !== value ? (
          <span className="px-2 text-[9px] font-mono text-muted-foreground/80 truncate" title={baseline}>
            vs {baseline}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function GroupBlock({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border-2 border-border bg-muted/60 overflow-hidden flex flex-col",
        className
      )}
    >
      <div className="px-2 py-1.5 bg-card border-b border-border text-center text-[11px] font-medium tracking-wide uppercase">
        {title}
      </div>
      <div className="flex-1 divide-y divide-border/30">{children}</div>
    </div>
  );
}

export function SetupSheetView({
  value,
  onChange,
  readOnly = false,
  highlightChangedKeys,
  baselineValue,
  className,
  template: templateProp,
  numericAggregationByKey = null,
}: SetupSheetViewProps) {
  const template = templateProp ?? getDefaultSetupSheetTemplate();
  const baseline = baselineValue ?? null;

  const commit = useCallback(
    (key: string, raw: string) => {
      const next = { ...value, [key]: coerceSetupValue(raw) };
      onChange(next);
    },
    [value, onChange]
  );

  const leftGroups = useMemo(
    () => template.groups.filter((g) => g.column === "left"),
    [template.groups]
  );
  const rightGroups = useMemo(
    () => template.groups.filter((g) => g.column === "right"),
    [template.groups]
  );
  const fullGroups = useMemo(
    () => template.groups.filter((g) => g.column === "full" || !g.column),
    [template.groups]
  );

  const pairedRowCount = Math.max(leftGroups.length, rightGroups.length);

  const isChanged = (key: string) => {
    if (highlightChangedKeys?.has(key)) return true;
    if (!baseline) return false;
    const a = fieldValue(value, key);
    const b = fieldValue(baseline, key);
    return a !== b && (a !== "" || b !== "");
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-3 shadow-sm",
        className
      )}
      data-setup-sheet-template={template.id}
    >
      <div className="text-center border-b-2 border-border pb-2 mb-3">
        <div className="text-[10px] font-medium text-muted-foreground tracking-widest">SETUP SHEET</div>
        <div className="text-xs font-medium mt-0.5">{template.label}</div>
      </div>

      {template.structuredSections?.length ? (
        <SetupSheetStructured
          sections={template.structuredSections}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
          baselineValue={baseline}
          highlightChangedKeys={highlightChangedKeys ?? null}
          numericAggregationByKey={numericAggregationByKey}
        />
      ) : null}

      {!template.structuredSections?.length ? (
        <>
      <div className="mb-3 space-y-3">
        {Array.from({ length: pairedRowCount }, (_, rowIndex) => {
          const left = leftGroups[rowIndex];
          const right = rightGroups[rowIndex];
          return (
            <div
              key={`pair-${rowIndex}`}
              className="grid grid-cols-1 md:grid-cols-2 md:items-stretch gap-3"
            >
              {left ? (
                <GroupBlock title={left.title}>
                  {left.fields.map((f) => (
                    <SheetCell
                      key={f.key}
                      field={f}
                      value={fieldValue(value, f.key)}
                      baseline={baseline ? fieldValue(baseline, f.key) : ""}
                      changed={isChanged(f.key)}
                      onCommit={commit}
                      readOnly={readOnly}
                    />
                  ))}
                </GroupBlock>
              ) : (
                <div className="hidden md:block" aria-hidden />
              )}
              {right ? (
                <GroupBlock title={right.title}>
                  {right.fields.map((f) => (
                    <SheetCell
                      key={f.key}
                      field={f}
                      value={fieldValue(value, f.key)}
                      baseline={baseline ? fieldValue(baseline, f.key) : ""}
                      changed={isChanged(f.key)}
                      onCommit={commit}
                      readOnly={readOnly}
                    />
                  ))}
                </GroupBlock>
              ) : (
                <div className="hidden md:block" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {fullGroups.map((g) => (
        <GroupBlock key={g.id} title={g.title} className="mb-3 last:mb-0">
          {g.fields.map((f) => (
            <SheetCell
              key={f.key}
              field={f}
              value={fieldValue(value, f.key)}
              baseline={baseline ? fieldValue(baseline, f.key) : ""}
              changed={isChanged(f.key)}
              onCommit={commit}
              readOnly={readOnly}
            />
          ))}
        </GroupBlock>
      ))}
        </>
      ) : null}

      {!readOnly && (
        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Structured setup snapshot · stable keys for compare/diff
        </p>
      )}
    </div>
  );
}
