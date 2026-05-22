"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildGroupedRuleFromAssignments,
  defaultOptionAssignments,
  filterParametersForWidgetCount,
  groupedBehaviorForModelField,
  isGroupedModelField,
  isModelParameterMapped,
  listModelParameters,
  modelFieldOptionEntries,
  type ModelOptionAssignment,
  type ModelParameterRow,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";

export type WidgetSelectOption = { value: string; label: string };

export function SetupCalibrationLinkParameterDialog(props: {
  open: boolean;
  widgetSourceKeys: string[];
  widgetOptions: WidgetSelectOption[];
  schema: SetupSheetModelSchema;
  formFieldMappings: Record<string, import("@/lib/setupCalibrations/types").PdfFormFieldMappingRule>;
  /** When editing an existing grouped mapping */
  initialParameterKey?: string | null;
  initialAssignments?: ModelOptionAssignment[] | null;
  onClose: () => void;
  onConfirmSimple: (parameterKey: string) => void;
  onConfirmGrouped: (parameterKey: string, assignments: ModelOptionAssignment[]) => void;
  /** When user activates “Assign on PDF” for an option row */
  assignOnPdfOptionValue?: string | null;
  onAssignOnPdfOptionChange?: (optionValue: string | null) => void;
  /** Controlled assignments for the assign step (so parent can update on PDF click). */
  assignments?: ModelOptionAssignment[] | null;
  onAssignmentsChange?: (next: ModelOptionAssignment[]) => void;
}) {
  const {
    open,
    widgetSourceKeys,
    widgetOptions,
    schema,
    formFieldMappings,
    initialParameterKey,
    initialAssignments,
    onClose,
    onConfirmSimple,
    onConfirmGrouped,
    assignOnPdfOptionValue = null,
    onAssignOnPdfOptionChange,
    assignments: controlledAssignments,
    onAssignmentsChange,
  } = props;

  const widgetCount = widgetSourceKeys.length;
  const allRows = useMemo(
    () =>
      listModelParameters(schema).map((r) => ({
        ...r,
        mapped: isModelParameterMapped(r.field, formFieldMappings),
      })),
    [schema, formFieldMappings]
  );

  const eligibleRows = useMemo(
    () => filterParametersForWidgetCount(allRows, widgetCount),
    [allRows, widgetCount]
  );

  const [step, setStep] = useState<"pick" | "assign">("pick");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [internalAssignments, setInternalAssignments] = useState<ModelOptionAssignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const assignments = controlledAssignments ?? internalAssignments;
  const setAssignments = onAssignmentsChange ?? setInternalAssignments;
  const assignOnPdfRow = assignOnPdfOptionValue;
  const setAssignOnPdfRow = (v: string | null) => onAssignOnPdfOptionChange?.(v);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initialParameterKey && initialAssignments?.length) {
      setSelectedKey(initialParameterKey);
      setAssignments(initialAssignments);
      setStep("assign");
      return;
    }
    setStep("pick");
    setSelectedKey(null);
    setAssignments([]);
    onAssignOnPdfOptionChange?.(null);
  }, [open, initialParameterKey, initialAssignments, onAssignOnPdfOptionChange]);

  const selectedField = useMemo(() => {
    if (!selectedKey) return null;
    return schema.fields.find((f) => f.key === selectedKey) ?? null;
  }, [schema.fields, selectedKey]);

  const optionEntries = useMemo(
    () => (selectedField ? modelFieldOptionEntries(selectedField) : []),
    [selectedField]
  );

  function goToAssign(row: ModelParameterRow) {
    setSelectedKey(row.field.key);
    setError(null);
    if (isGroupedModelField(row.field)) {
      const optCount = modelFieldOptionEntries(row.field).length;
      if (optCount < 2) {
        setError(
          `“${row.field.displayLabel}” has no options on the sheet model. Open the schema editor, add one option per line (e.g. 1, 2, 3, 4), save, then return here.`
        );
        return;
      }
      if (widgetCount !== optCount) {
        setError(
          `“${row.field.displayLabel}” has ${optCount} options — select exactly ${optCount} PDF control${optCount === 1 ? "" : "s"} on the sheet (you have ${widgetCount}).`
        );
        return;
      }
      setAssignments(
        initialAssignments?.length && initialParameterKey === row.field.key
          ? initialAssignments
          : defaultOptionAssignments(row.field, widgetSourceKeys)
      );
      setStep("assign");
    } else {
      onConfirmSimple(row.field.key);
    }
  }

  function usedWidgets(excludeOptionValue?: string): Set<string> {
    const s = new Set<string>();
    for (const a of assignments) {
      if (excludeOptionValue && a.optionValue === excludeOptionValue) continue;
      if (a.sourceKey.trim()) s.add(a.sourceKey);
    }
    return s;
  }

  function validateAssignments(): string | null {
    if (!selectedField) return "Pick a parameter.";
    const opts = modelFieldOptionEntries(selectedField);
    if (assignments.length !== opts.length) return "Assignment count mismatch.";
    const used = new Set<string>();
    for (const a of assignments) {
      if (!a.sourceKey.trim()) return `Assign a PDF control for “${a.optionLabel}”.`;
      if (used.has(a.sourceKey)) return "Each PDF control can only be used once.";
      used.add(a.sourceKey);
      if (!widgetSourceKeys.includes(a.sourceKey)) return "Invalid widget selection.";
    }
    return null;
  }

  function handleConfirmGrouped() {
    const err = validateAssignments();
    if (err) {
      setError(err);
      return;
    }
    if (!selectedKey) return;
    onConfirmGrouped(selectedKey, assignments);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="link-param-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-card shadow-lg">
        <div className="border-b border-border px-4 py-3">
          <div id="link-param-title" className="text-sm font-semibold text-foreground">
            {step === "pick" ? "Link to parameter" : "Match each option to a PDF control"}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {step === "pick"
              ? widgetCount === 1
                ? "1 PDF control selected — choose a simple parameter (number, text, or checkbox)."
                : `${widgetCount} PDF controls selected — choose a grouped parameter (one of many or many of many).`
              : `Define which control is which for “${selectedField?.displayLabel ?? ""}”.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">
          {error ? (
            <div className="mb-3 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100">
              {error}
            </div>
          ) : null}

          {step === "pick" ? (
            <div className="space-y-1">
              {eligibleRows.length === 0 ? (
                <p className="text-muted-foreground">
                  No parameters match this selection.{" "}
                  {widgetCount === 1
                    ? "Try a single PDF control, or add simple parameters on the sheet model."
                    : "Select the same number of PDF controls as the parameter has options."}
                </p>
              ) : (
                eligibleRows.map((row) => {
                  const optCount = isGroupedModelField(row.field)
                    ? modelFieldOptionEntries(row.field).length
                    : 0;
                  const countMismatch =
                    isGroupedModelField(row.field) && optCount >= 2 && optCount !== widgetCount;
                  return (
                  <button
                    key={row.field.key}
                    type="button"
                    disabled={countMismatch}
                    className={`flex w-full flex-col gap-0.5 rounded border px-3 py-2 text-left ${
                      countMismatch
                        ? "cursor-not-allowed border-border/50 bg-muted/15 opacity-60"
                        : "border-border bg-muted/25 hover:bg-muted/50"
                    }`}
                    onClick={() => goToAssign(row)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{row.field.displayLabel}</span>
                      <span
                        className={`shrink-0 text-[10px] ${row.mapped ? "text-emerald-300" : "text-muted-foreground"}`}
                      >
                        {row.mapped ? "Mapped" : "Unmapped"}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {row.field.sectionTitle} · {row.kind.replace(/_/g, " ")}
                      {isGroupedModelField(row.field)
                        ? ` · ${modelFieldOptionEntries(row.field).length} options`
                        : ""}
                    </span>
                    {countMismatch ? (
                      <span className="text-[10px] text-amber-200/90">
                        Select {optCount} PDF controls (you have {widgetCount})
                      </span>
                    ) : null}
                  </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground">
                Each row must use a different PDF control from your selection. Change dropdowns or use{" "}
                <span className="font-medium text-foreground/90">Assign on PDF</span> then click a highlighted control.
              </p>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                    <th className="pb-1 pr-2 font-medium">Option</th>
                    <th className="pb-1 font-medium">PDF control</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => {
                    const taken = usedWidgets(a.optionValue);
                    return (
                      <tr key={a.optionValue} className="border-b border-border/60">
                        <td className="py-2 pr-2 align-top font-medium text-foreground">{a.optionLabel}</td>
                        <td className="py-2 align-top">
                          <div className="flex flex-col gap-1">
                            <select
                              className="w-full rounded border border-border bg-card px-2 py-1 text-xs"
                              value={a.sourceKey}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAssignments(
                                  assignments.map((x) =>
                                    x.optionValue === a.optionValue ? { ...x, sourceKey: v } : x
                                  )
                                );
                                setError(null);
                              }}
                            >
                              <option value="">— choose —</option>
                              {widgetOptions.map((w) => (
                                <option
                                  key={w.value}
                                  value={w.value}
                                  disabled={taken.has(w.value) && w.value !== a.sourceKey}
                                >
                                  {w.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className={`rounded border px-2 py-0.5 text-[10px] ${
                                assignOnPdfRow === a.optionValue
                                  ? "border-sky-500/70 bg-sky-500/15 text-sky-100"
                                  : "border-border text-muted-foreground hover:bg-muted/50"
                              }`}
                              onClick={() =>
                                setAssignOnPdfRow(assignOnPdfRow === a.optionValue ? null : a.optionValue)
                              }
                            >
                              {assignOnPdfRow === a.optionValue ? "Click PDF… (active)" : "Assign on PDF"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
          {step === "assign" ? (
            <button
              type="button"
              className="mr-auto rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
              onClick={() => {
                setStep("pick");
                setError(null);
                setAssignOnPdfRow(null);
              }}
            >
              ← Back
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
            onClick={onClose}
          >
            Cancel
          </button>
          {step === "assign" ? (
            <button
              type="button"
              className="rounded border border-sky-500/60 bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-500/25"
              onClick={handleConfirmGrouped}
            >
              Confirm mapping
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export { groupedBehaviorForModelField, buildGroupedRuleFromAssignments };
