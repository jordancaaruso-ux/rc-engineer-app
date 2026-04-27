"use client";

import type {
  CustomFieldUiType,
  CustomFieldValueType,
  CustomSetupFieldDefinition,
  SetupFieldDomain,
} from "@/lib/setupCalibrations/types";
import type { CalibrationFieldRecipeId } from "@/lib/setupCalibrations/calibrationCustomFieldHints";

type FieldKindPresetId =
  | "text_line"
  | "notes"
  | "number"
  | "toggle"
  | "dropdown"
  | "date"
  | "multi_pick"
  | "line_list"
  | "custom";

const FIELD_KIND_PRESETS: {
  id: FieldKindPresetId;
  label: string;
  valueType: CustomFieldValueType;
  uiType: CustomFieldUiType;
}[] = [
  { id: "text_line", label: "Text, one line", valueType: "string", uiType: "text" },
  { id: "notes", label: "Text, big notes area", valueType: "string", uiType: "textarea" },
  { id: "number", label: "Number", valueType: "number", uiType: "text" },
  { id: "toggle", label: "On / off (one checkbox)", valueType: "boolean", uiType: "checkbox" },
  { id: "dropdown", label: "Choose one (dropdown list)", valueType: "enum", uiType: "select" },
  { id: "date", label: "Date (calendar)", valueType: "date", uiType: "date" },
  { id: "multi_pick", label: "Pick several (multi)", valueType: "multi", uiType: "multiSelect" },
  { id: "line_list", label: "List of short lines", valueType: "string_array", uiType: "textarea" },
];

function fieldKindPresetIdFromTypes(
  valueType: CustomFieldValueType,
  uiType: CustomFieldUiType
): FieldKindPresetId {
  const m = FIELD_KIND_PRESETS.find((e) => e.valueType === valueType && e.uiType === uiType);
  if (m) return m.id;
  return "custom";
}

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
  const fieldKind = fieldKindPresetIdFromTypes(p.cfValueType, p.cfUiType);
  const fieldKindSelectValue: FieldKindPresetId | "custom" = fieldKind === "custom" ? "custom" : fieldKind;

  const layoutOpts: Array<{ v: CustomSetupFieldDefinition["layoutPlacement"]; label: string }> = [
    { v: "none", label: "Default" },
    { v: "full", label: "Full width" },
    { v: "front", label: "Front" },
    { v: "rear", label: "Rear" },
    { v: "left", label: "Left" },
    { v: "right", label: "Right" },
  ];

  return (
    <div className="space-y-3 rounded border border-emerald-500/40 bg-emerald-500/5 p-3">
      <div className="text-[10px] font-medium text-emerald-200/90">{title}</div>
      <p className="text-[10px] text-muted-foreground">
        {isTemplate
          ? "This calibration controls how PDF source fields map into setup values."
          : p.mode === "edit"
            ? "Edits this field only in this calibration."
            : "Name it, choose the kind of input, save, then map PDFs on the main calibration screen."}
      </p>
      {!isTemplate ? (
        <p className="text-[9px] text-muted-foreground/95">
          <span className="font-medium text-foreground/85">Chip rows / grouped buttons</span> (ARB, chassis, etc.): add those
          from the <span className="text-foreground/80">grouped</span> flow, not this form. This is for a single value.
        </p>
      ) : null}
      {showRecipes && p.onApplyRecipe ? (
        <div className="rounded border border-emerald-600/30 bg-emerald-950/20 px-2 py-2">
          <div className="text-[10px] font-medium text-emerald-100/80">Start here (or fill the fields below)</div>
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

      {isTemplate ? (
        <>
          <label className="block text-[11px] text-muted-foreground">
            Data id (from template)
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs disabled:opacity-60"
              value={p.cfKey}
              onChange={(e) => p.setCfKey(e.target.value)}
              placeholder="driver_name"
              disabled
            />
            <span className="mt-0.5 block text-[9px] text-muted-foreground/90">Read-only. Lowercase, underscores.</span>
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Name on the setup sheet <span className="text-rose-300">*</span>
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
              value={p.cfLabel}
              onChange={(e) => p.setCfLabel(e.target.value)}
              placeholder="Driver name"
            />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Section / group
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
        </>
      ) : (
        <>
          <div className="space-y-2.5">
            <label className="block text-[11px] text-muted-foreground">
              Name <span className="text-rose-300">*</span>
              <input
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                value={p.cfLabel}
                onChange={(e) => p.setCfLabel(e.target.value)}
                placeholder="e.g. ARB (front)"
              />
            </label>
            <label className="block text-[11px] text-muted-foreground">
              Section
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
            <label className="block text-[11px] text-muted-foreground">
              This field is
              <select
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                value={fieldKindSelectValue}
                onChange={(e) => {
                  const id = e.target.value as FieldKindPresetId | "custom";
                  if (id === "custom") {
                    p.setCfValueType("string");
                    p.setCfUiType("select");
                    return;
                  }
                  const pr = FIELD_KIND_PRESETS.find((o) => o.id === id);
                  if (pr) {
                    p.setCfValueType(pr.valueType);
                    p.setCfUiType(pr.uiType);
                  }
                }}
              >
                {FIELD_KIND_PRESETS.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
                <option value="custom">Custom (advanced)…</option>
              </select>
            </label>
            {fieldKind === "custom" ? (
              <div className="space-y-2 rounded border border-border/50 bg-card/20 px-2 py-2">
                <p className="text-[9px] text-muted-foreground">
                  Pick a stored data shape and a matching control. Most people use a preset above instead.
                </p>
                <label className="block text-[10px] text-muted-foreground">
                  Stored as
                  <select
                    className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                    value={p.cfValueType}
                    onChange={(e) => p.setCfValueType(e.target.value as CustomFieldValueType)}
                  >
                    <option value="string">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">On / off</option>
                    <option value="date">Date</option>
                    <option value="enum">One token</option>
                    <option value="multi">Many tokens</option>
                    <option value="string_array">Lines</option>
                  </select>
                </label>
                <label className="block text-[10px] text-muted-foreground">
                  Shown in the app as
                  <select
                    className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                    value={p.cfUiType}
                    onChange={(e) => p.setCfUiType(e.target.value as CustomFieldUiType)}
                  >
                    <option value="text">One line</option>
                    <option value="textarea">Notes area</option>
                    <option value="checkbox">Checkbox</option>
                    <option value="select">Dropdown</option>
                    <option value="multiSelect">Multi-select</option>
                    <option value="date">Date</option>
                    <option value="groupOption">Group chip (with grouped field)</option>
                  </select>
                </label>
              </div>
            ) : null}
            <label className="block text-[11px] text-muted-foreground">
              Id in saved data
              <input
                className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                value={p.cfKey}
                onChange={(e) => p.setCfKey(e.target.value)}
                placeholder="e.g. arb_front"
              />
              <span className="mt-0.5 block text-[9px] text-muted-foreground/90">Lowercase, underscores. Stays the same in files if you rename the label later.</span>
            </label>
          </div>

          {(p.cfUiType === "checkbox" || p.cfUiType === "groupOption") ? (
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
          {p.cfUiType === "groupOption" ? (
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

          <details className="rounded border border-border/50 bg-card/30 px-2 py-1.5">
            <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">More: category, visibility, unit, layout…</summary>
            <div className="mt-2 space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block text-[10px] text-muted-foreground">
                  Category
                  <select
                    className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                    value={p.cfFieldDomain}
                    onChange={(e) => p.setCfFieldDomain(e.target.value as SetupFieldDomain)}
                  >
                    <option value="setup">Setup / tuning</option>
                    <option value="metadata">Event, notes, extra</option>
                    <option value="document">Header / car / identity</option>
                  </select>
                </label>
                <label className="flex min-h-10 items-end gap-2 pb-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={p.cfIsMetadata}
                    onChange={(e) => p.setCfIsMetadata(e.target.checked)}
                  />
                  Treat as side metadata
                </label>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={p.cfShowInSetupSheet}
                    onChange={(e) => p.setCfShowInSetupSheet(e.target.checked)}
                  />
                  On setup sheet
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={p.cfShowInAnalysis}
                    onChange={(e) => p.setCfShowInAnalysis(e.target.checked)}
                  />
                  In analysis / compare
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={p.cfPdfExportable}
                    onChange={(e) => p.setCfPdfExportable(e.target.checked)}
                  />
                  When filling PDFs
                </label>
              </div>
              <label className="block text-[10px] text-muted-foreground">
                Unit (optional)
                <input
                  className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                  value={p.cfUnit}
                  onChange={(e) => p.setCfUnit(e.target.value)}
                  placeholder="mm, %, …"
                />
              </label>
              <label className="block text-[10px] text-muted-foreground">
                Your notes
                <textarea
                  className="mt-1 min-h-12 w-full resize-y rounded border border-border bg-card px-2 py-1 text-xs"
                  value={p.cfNotes}
                  onChange={(e) => p.setCfNotes(e.target.value)}
                />
              </label>
              <div className="border-t border-border/50 pt-2">
                <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/90">Layout & ordering</div>
                <div className="mt-1.5 space-y-2">
                  <label className="block text-[10px] text-muted-foreground">
                    Subsection (optional)
                    <input
                      className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                      value={p.cfSubsectionId}
                      onChange={(e) => p.setCfSubsectionId(e.target.value)}
                      placeholder="e.g. Motor mount, Top deck"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[10px] text-muted-foreground">
                      Sort order
                      <input
                        type="number"
                        className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
                        value={Number.isFinite(p.cfSortOrder) ? p.cfSortOrder : 0}
                        onChange={(e) => p.setCfSortOrder(Number(e.target.value) || 0)}
                      />
                    </label>
                    <label className="block text-[10px] text-muted-foreground">
                      Placement
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
                    Pair group id (optional)
                    <input
                      className="mt-1 w-full rounded border border-border bg-card px-2 py-1 font-mono text-xs"
                      value={p.cfPairGroupId}
                      onChange={(e) => p.setCfPairGroupId(e.target.value)}
                      placeholder="e.g. deck_pair_front_rear"
                    />
                  </label>
                </div>
              </div>
            </div>
          </details>
        </>
      )}
      {isTemplate ? (
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={p.cfShowInSetupSheet}
              onChange={(e) => p.setCfShowInSetupSheet(e.target.checked)}
            />
            On setup sheet
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={p.cfShowInAnalysis}
              onChange={(e) => p.setCfShowInAnalysis(e.target.checked)}
            />
            In analysis / compare
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={p.cfPdfExportable}
              onChange={(e) => p.setCfPdfExportable(e.target.checked)}
              disabled={isTemplate}
            />
            Include when filling PDFs
          </label>
        </div>
      ) : null}
      {isTemplate ? (
        <>
          <label className="block text-[11px] text-muted-foreground">
            Unit (optional)
            <input
              className="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs disabled:opacity-60"
              value={p.cfUnit}
              onChange={(e) => p.setCfUnit(e.target.value)}
              placeholder="mm, %, …"
              disabled
            />
          </label>
          <label className="block text-[11px] text-muted-foreground">
            Notes
            <textarea
              className="mt-1 min-h-12 w-full resize-y rounded border border-border bg-card px-2 py-1 text-xs disabled:opacity-60"
              value={p.cfNotes}
              onChange={(e) => p.setCfNotes(e.target.value)}
              disabled
            />
          </label>
        </>
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
