"use client";

import type {
  CustomFieldUiType,
  CustomFieldValueType,
  CustomSetupFieldDefinition,
  SetupFieldDomain,
} from "@/lib/setupCalibrations/types";

export type SetupFieldDefinitionFormProps = {
  mode: "create" | "edit";
  /** Base template fields: key/type are fixed; layout & visibility still editable. */
  fieldScope?: "new" | "custom" | "template";
  error: string | null;
  sectionOptions: Array<{ id: string; title: string }>;
  cfKey: string;
  setCfKey: (v: string) => void;
  cfLabel: string;
  setCfLabel: (v: string) => void;
  cfSectionId: string;
  setCfSectionId: (v: string) => void;
  cfFieldDomain: SetupFieldDomain;
  setCfFieldDomain: (v: SetupFieldDomain) => void;
  cfValueType: CustomFieldValueType;
  setCfValueType: (v: CustomFieldValueType) => void;
  cfUiType: CustomFieldUiType;
  setCfUiType: (v: CustomFieldUiType) => void;
  cfIsMetadata: boolean;
  setCfIsMetadata: (v: boolean) => void;
  cfShowInSetupSheet: boolean;
  setCfShowInSetupSheet: (v: boolean) => void;
  cfShowInAnalysis: boolean;
  setCfShowInAnalysis: (v: boolean) => void;
  cfPdfExportable: boolean;
  setCfPdfExportable: (v: boolean) => void;
  cfUnit: string;
  setCfUnit: (v: string) => void;
  cfCheckedValue: string;
  setCfCheckedValue: (v: string) => void;
  cfUncheckedValue: string;
  setCfUncheckedValue: (v: string) => void;
  cfGroupKey: string;
  setCfGroupKey: (v: string) => void;
  cfOptionValue: string;
  setCfOptionValue: (v: string) => void;
  cfNotes: string;
  setCfNotes: (v: string) => void;
  cfSubsectionId: string;
  setCfSubsectionId: (v: string) => void;
  cfLayoutPlacement: CustomSetupFieldDefinition["layoutPlacement"];
  setCfLayoutPlacement: (v: CustomSetupFieldDefinition["layoutPlacement"]) => void;
  cfPairGroupId: string;
  setCfPairGroupId: (v: string) => void;
  cfSortOrder: number;
  setCfSortOrder: (v: number) => void;
  /** From global calibration catalog (logical kind + setup | document). */
  fieldKindHint?: string;
  onCommit: () => void;
  onCancel: () => void;
};

/**
 * Single full editor for custom setup field definitions (create + edit).
 * Parent owns all state; this component is presentational only.
 */
export function SetupFieldDefinitionForm(p: SetupFieldDefinitionFormProps) {
  const scope = p.fieldScope ?? "new";
  const isTemplate = scope === "template";
  const title =
    isTemplate
      ? "Calibration field"
      : p.mode === "edit"
        ? "Edit calibration field"
        : "Create calibration field";
  const saveLabel = p.mode === "edit" || isTemplate ? "Save changes" : "Create & map";

  return (
    <div className="space-y-2 rounded border border-emerald-500/40 bg-emerald-500/5 p-3">
      <div className="text-[10px] font-medium text-emerald-200/90">{title}</div>
      <p className="text-[10px] text-muted-foreground">
        {isTemplate
          ? "This calibration controls how PDF source fields map into canonical setup values."
          : p.mode === "edit"
            ? "Changes apply to this calibration mapping profile."
            : "Defines a canonical field in this calibration mapping profile."}
      </p>
      {p.fieldKindHint ? (
        <div className="rounded border border-border/60 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">Field type</span>{" "}
          <span className="font-mono text-foreground/90">{p.fieldKindHint}</span>
        </div>
      ) : null}
      {p.error ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100">{p.error}</div>
      ) : null}
      <label className="block text-[11px] text-muted-foreground">
        Internal key (snake_case)
        <input
          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs disabled:opacity-60"
          value={p.cfKey}
          onChange={(e) => p.setCfKey(e.target.value)}
          placeholder="driver_name"
          disabled={isTemplate}
        />
      </label>
      <label className="block text-[11px] text-muted-foreground">
        Display label <span className="text-rose-300">*</span>
        <input
          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs disabled:opacity-60"
          value={p.cfLabel}
          onChange={(e) => p.setCfLabel(e.target.value)}
          placeholder="Driver name"
          disabled={isTemplate}
        />
      </label>
      <label className="block text-[11px] text-muted-foreground">
        Section / group (any sheet group)
        <select
          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
          value={p.cfSectionId}
          onChange={(e) => p.setCfSectionId(e.target.value)}
        >
          {p.sectionOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.title}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={p.cfShowInSetupSheet}
            onChange={(e) => p.setCfShowInSetupSheet(e.target.checked)}
          />
          Show on setup sheet
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={p.cfShowInAnalysis}
            onChange={(e) => p.setCfShowInAnalysis(e.target.checked)}
          />
          Show in analysis
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={p.cfPdfExportable}
            onChange={(e) => p.setCfPdfExportable(e.target.checked)}
            disabled={isTemplate}
          />
          PDF exportable
        </label>
      </div>
      <label className="block text-[11px] text-muted-foreground">
        Unit (optional)
        <input
          className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs disabled:opacity-60"
          value={p.cfUnit}
          onChange={(e) => p.setCfUnit(e.target.value)}
          placeholder="mm, %, …"
          disabled={isTemplate}
        />
      </label>
      {(p.cfUiType === "checkbox" || p.cfUiType === "groupOption") && !isTemplate ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            Checked value
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              value={p.cfCheckedValue}
              onChange={(e) => p.setCfCheckedValue(e.target.value)}
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Unchecked value
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              value={p.cfUncheckedValue}
              onChange={(e) => p.setCfUncheckedValue(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {p.cfUiType === "groupOption" && !isTemplate ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            Group key <span className="text-rose-300">*</span>
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              value={p.cfGroupKey}
              onChange={(e) => p.setCfGroupKey(e.target.value)}
              placeholder="screw_group_a"
            />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Option value
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
              value={p.cfOptionValue}
              onChange={(e) => p.setCfOptionValue(e.target.value)}
              placeholder="A"
            />
          </label>
        </div>
      ) : null}
      <label className="block text-[11px] text-muted-foreground">
        Notes
        <textarea
          className="mt-1 min-h-12 w-full resize-y rounded border border-border bg-card px-2 py-1 text-xs disabled:opacity-60"
          value={p.cfNotes}
          onChange={(e) => p.setCfNotes(e.target.value)}
          disabled={isTemplate}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded border border-emerald-500/60 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium hover:bg-emerald-500/25"
          onClick={p.onCommit}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-xs hover:bg-muted"
          onClick={p.onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
