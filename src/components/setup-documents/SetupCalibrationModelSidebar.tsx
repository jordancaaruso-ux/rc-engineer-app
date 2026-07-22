"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  isModelParameterMapped,
  modelFieldOptionEntries,
  type ModelOptionAssignment,
  type ModelParameterRow,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import { listModelParameters } from "@/lib/setupSheetModels/modelCalibrationMapping";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export type NewParameterInput = {
  displayLabel: string;
  sectionId: string;
  sectionTitle: string;
  kind: "value" | "one_of_many" | "many_of_many";
  optionLabels: string[];
};

export function SetupCalibrationModelSidebar(props: {
  schema: SetupSheetModelSchema;
  modelId: string;
  calibrationId: string;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  armedKey: string | null;
  armedAssignments: ModelOptionAssignment[];
  onArm: (parameterKey: string) => void;
  onDisarm: () => void;
  onCreateParameter: (input: NewParameterInput) => Promise<boolean>;
}) {
  const {
    schema,
    modelId,
    calibrationId,
    formFieldMappings,
    armedKey,
    armedAssignments,
    onArm,
    onDisarm,
    onCreateParameter,
  } = props;

  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addSection, setAddSection] = useState("");
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

  const sections = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of schema.fields) {
      if (!m.has(f.sectionId)) m.set(f.sectionId, f.sectionTitle || f.sectionId);
    }
    return [...m.entries()].map(([id, title]) => ({ id, title }));
  }, [schema]);

  const armedField = useMemo(
    () => (armedKey ? schema.fields.find((f) => f.key === armedKey) ?? null : null),
    [schema, armedKey]
  );
  const armedOptions = useMemo(
    () => (armedField ? modelFieldOptionEntries(armedField) : []),
    [armedField]
  );
  const nextOption = armedOptions[armedAssignments.length] ?? null;

  async function submitNewParameter() {
    const label = addLabel.trim();
    if (!label || addBusy) return;
    const section = sections.find((s) => s.id === addSection) ?? sections[0];
    const optionLabels = addOptions
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (addKind !== "value" && optionLabels.length < 2) return;
    setAddBusy(true);
    const ok = await onCreateParameter({
      displayLabel: label,
      sectionId: section?.id ?? "general",
      sectionTitle: section?.title ?? "General",
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
        <CardPanel className="border-accent/60 bg-accent/10" contentClassName="p-3">
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
                <span className="font-semibold text-primary">{nextOption?.label ?? "—"}</span>
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
                        current && "border-accent/70 bg-accent/20 text-foreground",
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
          Pick a parameter below, then click its box on the sheet.
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
                  filter === f ? "border-accent/60 bg-accent/10" : "border-border"
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
              {filter === "unmapped" ? "Every parameter is mapped." : "No parameters match."}
            </p>
          ) : (
            bySection.map(([title, sectionRows]) => (
              <div key={title}>
                <div className="text-[10px] font-medium text-muted-foreground">{title}</div>
                <div className="mt-1 flex flex-col gap-1">
                  {sectionRows.map((row: ModelParameterRow & { mapped: boolean }) => {
                    const isArmed = row.field.key === armedKey;
                    return (
                      <button
                        key={row.field.key}
                        type="button"
                        onClick={() => onArm(row.field.key)}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                          isArmed
                            ? "border-accent/70 bg-accent/15"
                            : row.mapped
                              ? "border-emerald-500/25 hover:bg-muted"
                              : "border-border/60 hover:bg-muted"
                        )}
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
            <select
              className="w-full rounded border border-border bg-card px-2 py-1.5 text-xs"
              value={addSection || sections[0]?.id || ""}
              onChange={(e) => setAddSection(e.target.value)}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
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
                    addKind === k ? "border-accent/60 bg-accent/10 text-foreground" : "border-border text-muted-foreground"
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
                className="flex-1 rounded border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
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
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
              onClick={() => setAddOpen(true)}
            >
              New parameter…
            </button>
            <Link
              href={`/setup-sheet-models/${modelId}/schema?returnTo=${encodeURIComponent(`/setup-calibrations/${calibrationId}`)}`}
              className="text-[10px] text-accent hover:underline"
            >
              Schema editor
            </Link>
          </div>
        )}
      </CardPanel>
    </div>
  );
}
