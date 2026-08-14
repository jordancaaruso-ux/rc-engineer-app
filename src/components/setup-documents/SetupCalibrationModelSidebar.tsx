"use client";

import { useMemo, useState } from "react";
import {
  isModelParameterMapped,
  modelFieldOptionEntries,
  type ModelOptionAssignment,
  type ModelParameterRow,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import {
  listModelParameters,
  modelMappingProgress,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export type NewParameterInput = {
  displayLabel: string;
  kind: "value" | "one_of_many" | "many_of_many";
  optionLabels: string[];
};

export function SetupCalibrationModelSidebar(props: {
  schema: SetupSheetModelSchema;
  modelId: string;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  armedKey: string | null;
  armedAssignments: ModelOptionAssignment[];
  onArm: (parameterKey: string) => void;
  onDisarm: () => void;
  onCreateParameter: (input: NewParameterInput) => Promise<boolean>;
  /** Preview a parameter's boxes on the sheet without arming it. */
  onHoverParameter: (parameterKey: string | null) => void;
  /** Clear a parameter's boxes, keeping the parameter. */
  onUnmapParameter: (parameterKey: string) => void;
  /** Remove the parameter from the chassis' sheet model. */
  onDeleteParameter: (parameterKey: string) => Promise<boolean>;
  /** Saved setups already holding a value for this parameter — shown before deleting. */
  parameterUsageCount: (parameterKey: string) => Promise<number | null>;
}) {
  const {
    schema,
    modelId,
    formFieldMappings,
    armedKey,
    armedAssignments,
    onArm,
    onDisarm,
    onCreateParameter,
    onHoverParameter,
    onUnmapParameter,
    onDeleteParameter,
    parameterUsageCount,
  } = props;

  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [confirmUsage, setConfirmUsage] = useState<number | null | "loading">("loading");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addKind, setAddKind] = useState<NewParameterInput["kind"]>("value");
  const [addOptions, setAddOptions] = useState("");

  const rows = useMemo(() => {
    const list = listModelParameters(schema).map((r) => ({
      ...r,
      mapped: isModelParameterMapped(r.field, formFieldMappings),
    }));
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === "unmapped" && r.mapped && r.field.key !== armedKey) return false;
      if (!q) return true;
      return (
        r.field.displayLabel.toLowerCase().includes(q)
        || r.field.key.toLowerCase().includes(q)
        || r.field.sectionTitle.toLowerCase().includes(q)
      );
    });
  }, [schema, formFieldMappings, filter, search, armedKey]);

  const bySection = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const title = r.field.sectionTitle || r.field.sectionId;
      const list = m.get(title) ?? [];
      list.push(r);
      m.set(title, list);
    }
    return [...m.entries()];
  }, [rows]);

  const progress = useMemo(
    () => modelMappingProgress(schema, formFieldMappings),
    [schema, formFieldMappings]
  );

  const armedField = useMemo(
    () => (armedKey ? schema.fields.find((f) => f.key === armedKey) ?? null : null),
    [schema, armedKey]
  );
  const armedOptions = useMemo(
    () => (armedField ? modelFieldOptionEntries(armedField) : []),
    [armedField]
  );
  const nextOption = armedOptions[armedAssignments.length] ?? null;

  async function startDelete(parameterKey: string) {
    setConfirmDeleteKey(parameterKey);
    setConfirmUsage("loading");
    const count = await parameterUsageCount(parameterKey);
    setConfirmUsage(count);
  }

  async function confirmDelete() {
    if (!confirmDeleteKey || deleteBusy) return;
    setDeleteBusy(true);
    const ok = await onDeleteParameter(confirmDeleteKey);
    setDeleteBusy(false);
    if (ok) setConfirmDeleteKey(null);
  }

  async function submitNewParameter() {
    const label = addLabel.trim();
    if (!label || addBusy) return;
    const optionLabels = addOptions
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (addKind !== "value" && optionLabels.length < 2) return;
    setAddBusy(true);
    const ok = await onCreateParameter({
      displayLabel: label,
      kind: addKind,
      optionLabels,
    });
    setAddBusy(false);
    if (ok) {
      setAddLabel("");
      setAddOptions("");
      setAddOpen(false);
    }
  }

  return (
    <div className="space-y-3 text-xs">
      {armedField ? (
        <CardPanel className="border-primary-ink/60 bg-accent/10" contentClassName="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {armedField.displayLabel}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {armedField.sectionTitle}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted"
              onClick={onDisarm}
            >
              Cancel
            </button>
          </div>

          {armedOptions.length === 0 ? (
            <p className="mt-2 text-[11px] text-foreground">Click its box on the sheet.</p>
          ) : (
            <>
              <p className="mt-2 text-[11px] text-foreground">
                Click the box for{" "}
                <span className="font-semibold text-primary-ink">{nextOption?.label ?? "—"}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {armedOptions.map((o, i) => {
                  const done = i < armedAssignments.length;
                  const current = i === armedAssignments.length;
                  return (
                    <span
                      key={o.value}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[10px]",
                        done && "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
                        current && "border-primary-ink/70 bg-accent/20 text-foreground",
                        !done && !current && "border-border text-muted-foreground"
                      )}
                    >
                      {done ? "✓ " : ""}
                      {o.label}
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </CardPanel>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {schema.fields.length === 0
            ? "Click any box on the sheet to name your first parameter."
            : "Click a box on the sheet to add a parameter, or pick one below to map it."}
        </p>
      )}

      <CardPanel contentClassName="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Parameters</Eyebrow>
          <div className="flex gap-1">
            {(["unmapped", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`rounded border px-2 py-0.5 text-[10px] capitalize ${
                  filter === f ? "border-primary-ink/60 bg-accent/10" : "border-border"
                }`}
                onClick={() => setFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <input
          className="mt-2 w-full rounded border border-border bg-muted/40 px-2 py-1.5 text-xs"
          placeholder="Search parameters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mt-2 max-h-[52vh] space-y-3 overflow-y-auto">
          {bySection.length === 0 ? (
            <p className="text-muted-foreground">
              {schema.fields.length === 0
                ? "No parameters yet — click a box on the sheet."
                : filter === "unmapped"
                  ? "Every parameter is mapped."
                  : "No parameters match."}
            </p>
          ) : (
            bySection.map(([title, sectionRows]) => (
              <div key={title}>
                <div className="text-[10px] font-medium text-muted-foreground">{title}</div>
                <div className="mt-1 flex flex-col gap-1">
                  {sectionRows.map((row: ModelParameterRow & { mapped: boolean }) => {
                    const isArmed = row.field.key === armedKey;
                    const isConfirming = confirmDeleteKey === row.field.key;
                    return (
                      <div
                        key={row.field.key}
                        onMouseEnter={() => onHoverParameter(row.field.key)}
                        onMouseLeave={() => onHoverParameter(null)}
                        className={cn(
                          "rounded-lg border transition-colors",
                          isArmed
                            ? "border-primary-ink/70 bg-accent/15"
                            : row.mapped
                              ? "border-emerald-500/25"
                              : "border-border/60"
                        )}
                      >
                        <div className="flex items-center gap-1 px-1">
                          <button
                            type="button"
                            onClick={() => onArm(row.field.key)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded px-1 py-1.5 text-left hover:bg-muted"
                          >
                            <div className="min-w-0">
                              <div className="truncate font-medium text-foreground">
                                {row.field.displayLabel}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {row.kind.replace(/_/g, " ")}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 text-[10px] ${
                                row.mapped ? "text-emerald-300" : "text-muted-foreground"
                              }`}
                            >
                              {row.mapped ? "✓" : "—"}
                            </span>
                          </button>
                          {row.mapped ? (
                            <button
                              type="button"
                              title="Clear this parameter's boxes"
                              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                              onClick={() => onUnmapParameter(row.field.key)}
                            >
                              Unmap
                            </button>
                          ) : null}
                          <button
                            type="button"
                            title="Delete this parameter"
                            aria-label={`Delete ${row.field.displayLabel}`}
                            className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void startDelete(row.field.key)}
                          >
                            ✕
                          </button>
                        </div>
                        {isConfirming ? (
                          <div className="space-y-1.5 border-t border-border/60 px-2 py-1.5">
                            <p className="text-[10px] text-muted-foreground">
                              {confirmUsage === "loading"
                                ? "Checking saved setups…"
                                : confirmUsage == null
                                  ? "Delete this parameter from the chassis sheet?"
                                  : confirmUsage === 0
                                    ? "No saved setups use it. Delete it?"
                                    : `${confirmUsage} saved setup${confirmUsage === 1 ? "" : "s"} use it — those values stop showing. Delete anyway?`}
                            </p>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                className="rounded border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive disabled:opacity-50"
                                onClick={() => void confirmDelete()}
                                disabled={deleteBusy}
                              >
                                {deleteBusy ? "Deleting…" : "Delete"}
                              </button>
                              <button
                                type="button"
                                className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                                onClick={() => setConfirmDeleteKey(null)}
                                disabled={deleteBusy}
                              >
                                Keep
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </CardPanel>

      <CardPanel contentClassName="p-3">
        {addOpen ? (
          <div className="space-y-2">
            <Eyebrow>New parameter</Eyebrow>
            <input
              className="w-full rounded border border-border bg-muted/40 px-2 py-1.5 text-xs"
              placeholder="Name (e.g. Front upper arm)"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              autoFocus
            />
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["value", "Value"],
                  ["one_of_many", "One of many"],
                  ["many_of_many", "Many of many"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`rounded border px-2 py-1 text-[10px] ${
                    addKind === k ? "border-primary-ink/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground"
                  }`}
                  onClick={() => setAddKind(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {addKind !== "value" ? (
              <textarea
                className="min-h-16 w-full rounded border border-border bg-card px-2 py-1.5 text-xs"
                placeholder={"One option per line\nCFF\nAlloy\nComp"}
                value={addOptions}
                onChange={(e) => setAddOptions(e.target.value)}
                spellCheck={false}
              />
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 rounded border border-primary-ink/60 bg-accent/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                onClick={() => void submitNewParameter()}
                disabled={addBusy || !addLabel.trim()}
              >
                {addBusy ? "Adding…" : "Add & map"}
              </button>
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="rounded border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                onClick={() => setAddOpen(true)}
              >
                New parameter…
              </button>
              <span className="text-[10px] text-muted-foreground">
                {progress.mapped}/{progress.total} mapped
              </span>
            </div>
          </div>
        )}
      </CardPanel>
    </div>
  );
}
