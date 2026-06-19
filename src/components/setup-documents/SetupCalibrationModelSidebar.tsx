"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  isModelParameterMapped,
  modelMappingProgress,
  type ModelParameterRow,
} from "@/lib/setupSheetModels/modelCalibrationMapping";
import { listModelParameters } from "@/lib/setupSheetModels/modelCalibrationMapping";
import type { PdfFormFieldMappingRule } from "@/lib/setupCalibrations/types";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { CardPanel } from "@/components/ui/CardPanel";
import { cn } from "@/lib/utils";

export function SetupCalibrationModelSidebar(props: {
  schema: SetupSheetModelSchema;
  modelId: string;
  calibrationId: string;
  formFieldMappings: Record<string, PdfFormFieldMappingRule>;
  widgetSelectionCount: number;
  onOpenLinkDialog: () => void;
  onClearSelection: () => void;
  onEditGroupedParameter?: (parameterKey: string) => void;
  calibrationDirty: boolean;
  onNavigateToAddParameter: () => void;
}) {
  const {
    schema,
    modelId,
    calibrationId,
    formFieldMappings,
    widgetSelectionCount,
    onOpenLinkDialog,
    onClearSelection,
    onEditGroupedParameter,
    calibrationDirty,
    onNavigateToAddParameter,
  } = props;

  const [filter, setFilter] = useState<"unmapped" | "all">("unmapped");
  const [search, setSearch] = useState("");

  const progress = useMemo(
    () => modelMappingProgress(schema, formFieldMappings),
    [schema, formFieldMappings]
  );

  const rows = useMemo(() => {
    const list = listModelParameters(schema).map((r) => ({
      ...r,
      mapped: isModelParameterMapped(r.field, formFieldMappings),
    }));
    const q = search.trim().toLowerCase();
    return list.filter((r) => {
      if (filter === "unmapped" && r.mapped) return false;
      if (!q) return true;
      return (
        r.field.displayLabel.toLowerCase().includes(q)
        || r.field.key.toLowerCase().includes(q)
        || r.field.sectionTitle.toLowerCase().includes(q)
      );
    });
  }, [schema, formFieldMappings, filter, search]);

  const bySection = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const r of rows) {
      const title = r.field.sectionTitle || r.field.sectionId;
      const list = m.get(title) ?? [];
      list.push(r);
      m.set(title, list);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const schemaReturnTo = `/setup-calibrations/${calibrationId}`;

  return (
    <div className="space-y-3 text-xs">
      <CardPanel className="border-primary/30 bg-primary/10" contentClassName="p-3">
        <div className="ui-title text-[11px] text-accent">Map PDF to parameters</div>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] text-muted-foreground">
          <li>Click one or more PDF controls on the left</li>
          <li>
            <span className="text-foreground/90">Link to parameter</span>
          </li>
          <li>For grouped fields, match each option (e.g. Mount 1, 2, 3…) to a control</li>
        </ol>
        <div className="mt-3 text-[11px]">
          <span className="font-medium text-foreground">
            {progress.mapped} / {progress.total}
          </span>{" "}
          <span className="text-muted-foreground">parameters mapped</span>
        </div>
      </CardPanel>

      {widgetSelectionCount > 0 ? (
        <CardPanel className="border-amber-500/40" contentClassName="p-3">
          <div className="font-medium text-foreground">
            {widgetSelectionCount} PDF control{widgetSelectionCount === 1 ? "" : "s"} selected
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-accent/60 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent/25"
              onClick={onOpenLinkDialog}
            >
              Link to parameter…
            </button>
            <button
              type="button"
              className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
              onClick={onClearSelection}
            >
              Clear
            </button>
          </div>
        </CardPanel>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Select PDF controls on the sheet to link them to a parameter.
        </p>
      )}

      <CardPanel contentClassName="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="ui-title text-[11px] text-muted-foreground">Parameters</div>
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
        <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto">
          {bySection.length === 0 ? (
            <p className="text-muted-foreground">
              {filter === "unmapped" ? "All parameters are mapped." : "No parameters match."}
            </p>
          ) : (
            bySection.map(([title, sectionRows]) => (
              <div key={title}>
                <div className="text-[10px] font-medium text-muted-foreground">{title}</div>
                <div className="mt-1 flex flex-col gap-1.5">
                  {sectionRows.map((row: ModelParameterRow & { mapped: boolean }) => (
                    <CardPanel
                      key={row.field.key}
                      className={cn(
                        row.mapped ? "border-emerald-500/30" : "border-border/60"
                      )}
                      contentClassName="flex items-center justify-between gap-2 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{row.field.displayLabel}</div>
                        <div className="text-[10px] text-muted-foreground">{row.kind.replace(/_/g, " ")}</div>
                      </div>
                      {row.mapped && onEditGroupedParameter
                      && (row.kind === "one_of_many" || row.kind === "many_of_many") ? (
                        <button
                          type="button"
                          className="shrink-0 rounded border border-border px-2 py-0.5 text-[10px] hover:bg-muted"
                          onClick={() => onEditGroupedParameter(row.field.key)}
                        >
                          Edit
                        </button>
                      ) : (
                        <span
                          className={`shrink-0 text-[10px] ${row.mapped ? "text-emerald-300" : "text-muted-foreground"}`}
                        >
                          {row.mapped ? "✓" : "—"}
                        </span>
                      )}
                    </CardPanel>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </CardPanel>

      <CardPanel contentClassName="p-3">
        <div className="text-[11px] font-medium text-foreground">Missing a parameter?</div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Add it on the sheet model, then return here.{" "}
          {calibrationDirty ? (
            <span className="text-amber-200/90">Save calibration first to keep your mappings.</span>
          ) : null}
        </p>
        <button
          type="button"
          className="mt-2 w-full rounded border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
          onClick={onNavigateToAddParameter}
        >
          Add parameter on sheet model…
        </button>
        <Link
          href={`/setup-sheet-models/${modelId}/schema?returnTo=${encodeURIComponent(schemaReturnTo)}`}
          className="mt-2 block text-center text-[10px] text-accent hover:underline"
        >
          Open schema editor
        </Link>
      </CardPanel>
    </div>
  );
}
