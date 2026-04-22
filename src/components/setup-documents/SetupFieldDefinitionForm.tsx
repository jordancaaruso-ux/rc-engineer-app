"use client";

import type {
  CustomFieldUiType,
  CustomFieldValueType,
  CustomSetupFieldDefinition,
  SetupFieldDomain,
} from "@/lib/setupCalibrations/types";
import type { CalibrationFieldRecipeId } from "@/lib/setupCalibrations/calibrationCustomFieldHints";

export type SetupFieldDefinitionFormProps = {
  mode: "create" | "edit";
  /** Base template fields: key/type are fixed; layout & visibility still editable. */
  fieldScope?: "new" | "custom" | "template";
  error: string | null;
  sectionOptions: Array<{ id: string; title: string }>;
  /** One-click defaults for value shape + domain (custom / new fields only). */
  onApplyRecipe?: (recipe: CalibrationFieldRecipeId) => void;
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
  const showRecipes = !isTemplate && Boolean(p.onApplyRecipe);
  const title =
    isTemplate
      ? "Calibration field"
      : p.mode === "edit"
        ? "Edit calibration field"
        : "Create calibration field";
  const saveLabel = p.mode === "edit" || isTemplate ? "Save changes" : "Create & map";

  const layoutOpts: Array<{ v: CustomSetupFieldDefinition["layoutPlacement"]; label: string }> = [
    { v: "none", label: "Default" },
    { v: "full", label: "Full width" },
    { v: "front", label: "Front" },
    { v: "rear", label: "Rear" },
    { v: "left", label: "Left" },
    { v: "right", label: "Right" },
  ];

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
      {!isTemplate ? (
        <p className="text-[10px] leading-relaxed text-muted-foreground border border-border/40 rounded bg-card/40 px-2 py-1.5">
          <span className="font-medium text-foreground/90">Other cars:</span> use a unique snake_case key per platform
          (e.g. <span className="font-mono text-foreground/80">motor_mount_screws_x4</span>). For{" "}
          <span className="text-foreground/90">motor mount screws</span> or <span className="text-foreground/90">top deck cuts</span>, select
          multiple PDF widgets, then use the pink <span className="text-fuchsia-200/90">grouped field</span> panel:{" "}
          <span className="italic">Visual multi</span> for screw strips, <span className="italic">Single-select</span> for one-of deck/cut
          layouts. After you save, use <span className="text-foreground/90">Map on PDF (chips)</span> in that panel or the same{" "}
          <span className="text-foreground/90">chip → click PDF</span> flow in the field catalog as for built-in single-select
          fields (e.g. chassis).
        </p>
      ) : null}
      {showRecipes && p.onApplyRecipe ? (
        <div className="rounded border border-emerald-600/30 bg-emerald-950/20 px-2 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-100/80">Quick shape</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {(
              [
                ["setup_text", "Setup · text"],
                ["setup_textarea", "Setup · notes"],
                ["setup_number", "Setup · number"],
                ["checkbox_toggle", "Setup · checkbox"],
                ["document_meta", "Document"],
                ["event_track_meta", "Event / track"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-50 hover:bg-emerald-500/20"
                onClick={() => p.onApplyRecipe!(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
      {!isTemplate ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-[11px] text-muted-foreground">
            Domain
            <select
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
              value={p.cfFieldDomain}
              onChange={(e) => p.setCfFieldDomain(e.target.value as SetupFieldDomain)}
            >
              <option value="setup">Setup (tuning / chassis values)</option>
              <option value="metadata">Metadata (event, notes)</option>
              <option value="document">Document (header / identity)</option>
            </select>
          </label>
          <label className="flex items-end gap-2 pb-0.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={p.cfIsMetadata}
              onChange={(e) => p.setCfIsMetadata(e.target.checked)}
            />
            Treat as metadata (import side-channel)
          </label>
        </div>
      ) : null}
      {!isTemplate ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-[11px] text-muted-foreground">
            Stored value type
            <select
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
              value={p.cfValueType}
              onChange={(e) => p.setCfValueType(e.target.value as CustomFieldValueType)}
            >
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="boolean">Boolean</option>
              <option value="date">Date</option>
              <option value="enum">Enum (single stored token)</option>
              <option value="multi">Multi (combined selection)</option>
              <option value="string_array">String array</option>
            </select>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Editor control
            <select
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
              value={p.cfUiType}
              onChange={(e) => p.setCfUiType(e.target.value as CustomFieldUiType)}
            >
              <option value="text">Text</option>
              <option value="textarea">Textarea</option>
              <option value="checkbox">Checkbox</option>
              <option value="select">Select</option>
              <option value="multiSelect">Multi-select</option>
              <option value="date">Date</option>
              <option value="groupOption">Group option (chip)</option>
            </select>
          </label>
        </div>
      ) : null}
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
      {!isTemplate ? (
        <details className="rounded border border-border/50 bg-card/30 px-2 py-1.5">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Layout & ordering</summary>
          <div className="mt-2 space-y-2">
            <label className="block text-[10px] text-muted-foreground">
              Subsection (optional grouping label)
              <input
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                value={p.cfSubsectionId}
                onChange={(e) => p.setCfSubsectionId(e.target.value)}
                placeholder="e.g. Motor mount, Top deck"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[10px] text-muted-foreground">
                Sheet sort order
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                  value={Number.isFinite(p.cfSortOrder) ? p.cfSortOrder : 0}
                  onChange={(e) => p.setCfSortOrder(Number(e.target.value) || 0)}
                />
              </label>
              <label className="block text-[10px] text-muted-foreground">
                Placement hint
                <select
                  className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                  value={p.cfLayoutPlacement ?? "none"}
                  onChange={(e) =>
                    p.setCfLayoutPlacement(
                      e.target.value === "none" ? "none" : (e.target.value as CustomSetupFieldDefinition["layoutPlacement"])
                    )
                  }
                >
                  {layoutOpts.map(({ v, label }) => (
                    <option key={v ?? "none"} value={v ?? "none"}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block text-[10px] text-muted-foreground">
              Pair group id (optional — links front/rear style rows)
              <input
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                value={p.cfPairGroupId}
                onChange={(e) => p.setCfPairGroupId(e.target.value)}
                placeholder="e.g. deck_pair_front_rear"
              />
            </label>
          </div>
        </details>
      ) : null}
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
