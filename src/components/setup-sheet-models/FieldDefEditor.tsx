"use client";

import { useState } from "react";
import { schemaKindFromField } from "@/lib/setupSheetModels/fieldParamTypes";
import { groupedOptionValueFromLabel } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { UNIVERSAL_TOURING_PARAMETERS } from "@/lib/setupSheetModels/universalParameters";
import { OptionRowsEditor } from "@/components/setup-sheet-models/OptionRowsEditor";
import type { SetupSheetModelFieldDef } from "@/lib/setupSheetModels/types";

/**
 * Inline editor for one parameter's definition — the panel the unified canvas opens when you click a
 * row. Lifted from the old Parameters-tab `FieldEditPanel`, plus the three per-surface visibility
 * toggles (which used to be separate list buttons). Identity fields — `key`, value/ui type — stay
 * read-only: the key is a stable id and a mid-life type change is risky.
 *
 * When the clicked row is a group, `groupLabel`/`onSaveGroupLabel` are provided so the row's label
 * is editable here too (the parent wires this to `layoutCanvasOps.setGroupRowLabel`).
 */
export function FieldDefEditor(props: {
  field: SetupSheetModelFieldDef;
  /** Admin-only: choose the canonical cross-car parameter by hand. Hidden (and the badge too) otherwise. */
  isAdmin?: boolean;
  /** Present when the clicked row is a group — enables the group-label field. */
  groupLabel?: string | null;
  onSave: (patch: Partial<SetupSheetModelFieldDef>) => void;
  onSaveGroupLabel?: (label: string) => void;
  onCancel: () => void;
}) {
  const { field, isAdmin } = props;
  const [displayLabel, setDisplayLabel] = useState(field.displayLabel);
  const [unit, setUnit] = useState(field.unit ?? "");
  const [optionLabels, setOptionLabels] = useState<string[]>(field.groupedOptionLabels ?? []);
  const [universalId, setUniversalId] = useState(field.universalParameterId ?? "");
  const [groupLabel, setGroupLabel] = useState(props.groupLabel ?? "");
  const [showInSetupSheet, setShowInSetupSheet] = useState(field.showInSetupSheet);
  const [showInLogRun, setShowInLogRun] = useState(field.showInLogRun);
  const [showInAnalysis, setShowInAnalysis] = useState(field.showInAnalysis);
  const kind = schemaKindFromField(field);
  const hasGroupLabel = props.groupLabel != null && props.onSaveGroupLabel != null;

  return (
    <div className="mt-2 w-full space-y-2 rounded border border-border/80 bg-card p-2">
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-[10px] text-muted-foreground">{field.key}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{kind}</span>
        {isAdmin && field.universalParameterId ? (
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] tabular-nums text-sky-200">
            ↗ {field.universalParameterId}
          </span>
        ) : null}
      </div>

      <label className="block text-[10px] text-muted-foreground">
        Label
        <input
          className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1"
          value={displayLabel}
          onChange={(e) => setDisplayLabel(e.target.value)}
        />
      </label>
      <label className="block text-[10px] text-muted-foreground">
        Unit
        <input
          className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </label>

      {hasGroupLabel ? (
        <label className="block text-[10px] text-muted-foreground">
          Row (group) label
          <input
            className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
          />
        </label>
      ) : null}

      {isAdmin ? (
        <label className="block text-[10px] text-muted-foreground">
          Universal parameter (cross-car stats)
          <select
            className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1 text-xs"
            value={universalId}
            onChange={(e) => setUniversalId(e.target.value)}
          >
            <option value="">None — use sheet key only</option>
            {UNIVERSAL_TOURING_PARAMETERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.id})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {(kind === "one_of_many" || kind === "many_of_many") && (
        <div className="space-y-1 text-[10px] text-muted-foreground">
          <div>Options</div>
          <OptionRowsEditor
            idPrefix={`edit-${field.key}`}
            options={optionLabels}
            onChange={setOptionLabels}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showInSetupSheet}
            onChange={(e) => setShowInSetupSheet(e.target.checked)}
          />
          Setup sheet
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showInLogRun}
            onChange={(e) => setShowInLogRun(e.target.checked)}
          />
          Log run
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showInAnalysis}
            onChange={(e) => setShowInAnalysis(e.target.checked)}
          />
          Analysis
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-sky-500/60 bg-sky-500/15 px-2 py-1 text-[10px] font-medium"
          onClick={() => {
            const labels = optionLabels.map((l) => l.trim()).filter(Boolean);
            const patch: Partial<SetupSheetModelFieldDef> = {
              displayLabel: displayLabel.trim() || field.displayLabel,
              unit: unit.trim() || undefined,
              universalParameterId: universalId.trim() || undefined,
              showInSetupSheet,
              showInLogRun,
              showInAnalysis,
            };
            if (kind === "one_of_many" || kind === "many_of_many") {
              if (labels.length >= 2) {
                patch.groupedOptionLabels = labels;
                patch.groupedOptionValues = labels.map((l, i) => groupedOptionValueFromLabel(l, i));
              }
            }
            props.onSave(patch);
            if (hasGroupLabel && groupLabel.trim() !== (props.groupLabel ?? "").trim()) {
              props.onSaveGroupLabel!(groupLabel);
            }
          }}
        >
          Save
        </button>
        <button type="button" className="text-[10px] text-muted-foreground" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
