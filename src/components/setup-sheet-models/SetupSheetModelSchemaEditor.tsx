"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CUSTOM_FIELD_SECTION_PRESETS,
  suggestKeyFromPdfFieldName,
} from "@/lib/setupCalibrations/customFieldCatalog";
import {
  buildFieldDefFromKind,
  schemaKindFromField,
  type SchemaParameterKind,
} from "@/lib/setupSheetModels/fieldParamTypes";
import type { SetupSheetModelFieldDef, SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import {
  assignFieldsToManualLayoutGroup,
  fieldsInSameManualGroup,
  inferStructuredLayoutFromFields,
  rebuildSectionLayout,
  ungroupLayoutGroup,
  updateLayoutGroupLabel,
} from "@/lib/setupSheetModels/layoutGroupOps";
import { collectModelLayoutKeys } from "@/lib/setupSheetModels/filterStructuredLayoutByKeys";
import { addFieldToLayout } from "@/lib/setupSheetModels/layoutEditorOps";
import {
  UNIVERSAL_TOURING_PARAMETERS,
  universalParameterIdForSnapshotKey,
} from "@/lib/setupSheetModels/universalParameters";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import { groupedOptionValueFromLabel } from "@/lib/setupSheetModels/enrichGroupedFieldOptions";
import { awesomatixFieldKeyCollisionWarning } from "@/lib/setupSheetModels/awesomatixFieldKeyCollision";
import { OptionRowsEditor } from "@/components/setup-sheet-models/OptionRowsEditor";
import { Eyebrow } from "@/components/ui/panel";

const KIND_OPTIONS: { value: SchemaParameterKind; label: string }[] = [
  { value: "number", label: "Number" },
  { value: "text", label: "Text / notes" },
  { value: "checkbox", label: "Checkbox" },
  { value: "one_of_many", label: "One of many (pick one)" },
  { value: "many_of_many", label: "Many of many" },
];

const SECTION_PRESETS = CUSTOM_FIELD_SECTION_PRESETS.filter((p) =>
  ["suspension", "drivetrain", "tyres_body", "tuning", "platform_chassis", "other"].includes(p.id)
);

export function SetupSheetModelSchemaEditor(props: {
  schema: SetupSheetModelSchema;
  onChange: (schema: SetupSheetModelSchema) => void;
  readOnly?: boolean;
  /**
   * Admins pick a field's canonical parameter by hand. For everyone else it is inferred and hidden:
   * cross-car pooling is invisible to the person building a sheet, and a *wrong* canonical id is
   * worse than none — it pools this car's numbers into another parameter's distribution.
   */
  isAdmin?: boolean;
}) {
  const { schema, onChange, readOnly } = props;
  const isAdmin = props.isAdmin === true;
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<SchemaParameterKind>("number");
  const [sectionId, setSectionId] = useState("tuning");
  const [unit, setUnit] = useState("");
  const [optionLabels, setOptionLabels] = useState<string[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<Set<string>>(new Set());

  const sectionTitle = useMemo(() => {
    const m = new Map(SECTION_PRESETS.map((p) => [p.id, p.title] as const));
    for (const f of schema.fields) m.set(f.sectionId, f.sectionTitle);
    return (id: string) => m.get(id) ?? id;
  }, [schema.fields]);

  const fieldsBySection = useMemo(() => {
    const map = new Map<string, SetupSheetModelFieldDef[]>();
    for (const f of [...schema.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = map.get(f.sectionId) ?? [];
      list.push(f);
      map.set(f.sectionId, list);
    }
    return map;
  }, [schema.fields]);

  const layoutKeys = useMemo(
    () => collectModelLayoutKeys(schema.structuredSections),
    [schema.structuredSections]
  );

  const addFieldKeyPreview = useMemo(() => {
    const trimmed = key.trim();
    return trimmed || (label.trim() ? suggestKeyFromPdfFieldName(label.trim()) : "");
  }, [key, label]);

  const addFieldCollisionWarning = useMemo(
    () => awesomatixFieldKeyCollisionWarning(addFieldKeyPreview, kind),
    [addFieldKeyPreview, kind]
  );

  const updateField = useCallback(
    (key: string, patch: Partial<SetupSheetModelFieldDef>) => {
      onChange({
        ...schema,
        fields: schema.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
      });
    },
    [schema, onChange]
  );

  const removeField = useCallback(
    (removedKey: string) => {
      const removed = schema.fields.find((f) => f.key === removedKey);
      const nextFields = schema.fields.filter((f) => f.key !== removedKey);
      const secId = removed?.sectionId ?? "other";
      const secTitle = removed?.sectionTitle ?? sectionTitle(secId);
      onChange({
        ...schema,
        fields: nextFields,
        structuredSections: rebuildSectionLayout(
          schema.structuredSections,
          secId,
          secTitle,
          nextFields,
          schema.layoutGroups
        ),
      });
    },
    [schema, onChange, sectionTitle]
  );

  const addField = useCallback(() => {
    setLocalError(null);
    const sec = SECTION_PRESETS.find((p) => p.id === sectionId) ?? SECTION_PRESETS[SECTION_PRESETS.length - 1]!;
    const optLabels =
      kind === "one_of_many" || kind === "many_of_many"
        ? optionLabels.map((l) => l.trim()).filter(Boolean)
        : undefined;
    const maxOrder = schema.fields.reduce((m, f) => Math.max(m, f.sortOrder), -1);
    const built = buildFieldDefFromKind({
      displayLabel: label,
      key: key.trim() || undefined,
      kind,
      sectionId: sec.id,
      sectionTitle: sec.title,
      unit: unit.trim() || undefined,
      optionLabels: optLabels,
      sortOrder: maxOrder + 1,
    });
    if ("error" in built) {
      setLocalError(built.error);
      return;
    }
    if (schema.fields.some((f) => f.key === built.key)) {
      setLocalError(`Key "${built.key}" already exists on this sheet model.`);
      return;
    }
    const collision = awesomatixFieldKeyCollisionWarning(built.key, kind);
    if (collision) {
      setLocalError(collision);
      return;
    }
    // Infer the canonical cross-car parameter up front. `suggestUniversalParameterId` returns
    // nothing when it isn't sure (e.g. an axle-ambiguous "toe gain"), so a guess never pools this
    // field into the wrong distribution. Admins can still override it in the edit panel.
    const inferredUniversalId = suggestUniversalParameterId(built.key, built.displayLabel);
    const nextFields = [
      ...schema.fields,
      inferredUniversalId ? { ...built, universalParameterId: inferredUniversalId } : built,
    ];
    onChange({
      ...schema,
      fields: nextFields,
      structuredSections: rebuildSectionLayout(
        schema.structuredSections,
        sec.id,
        sec.title,
        nextFields,
        schema.layoutGroups
      ),
    });
    setLabel("");
    setKey("");
    setOptionLabels([]);
    setAddOpen(false);
  }, [schema, onChange, label, key, kind, sectionId, unit, optionLabels]);

  const rebuildLayout = useCallback(() => {
    if (
      !window.confirm(
        "Rebuild sheet layout from field keys? FF/FR/RF/RR fields group into one row; front/rear into pairs."
      )
    ) {
      return;
    }
    onChange({
      ...schema,
      structuredSections: inferStructuredLayoutFromFields(
        schema.fields,
        schema.structuredSections,
        schema.layoutGroups
      ),
    });
  }, [schema, onChange]);

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <button
          type="button"
          className="rounded border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={rebuildLayout}
        >
          Rebuild layout from fields
        </button>
      ) : null}

      {localError ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{localError}</div>
      ) : null}

      {[...fieldsBySection.entries()].map(([secId, fields]) => {
        const sectionSelected = fields.filter((f) => selectedFieldKeys.has(f.key));
        return (
        <div key={secId} className="rounded-lg border border-border bg-card/80 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{sectionTitle(secId)}</Eyebrow>
            {!readOnly && sectionSelected.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="text-muted-foreground">{sectionSelected.length} selected</span>
                {sectionSelected.length === 2 ? (
                  <button
                    type="button"
                    className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-sky-200"
                    onClick={() => {
                      const next = assignFieldsToManualLayoutGroup(
                        schema,
                        sectionSelected.map((f) => f.key),
                        "pair"
                      );
                      if ("error" in next) setLocalError(next.error);
                      else {
                        setLocalError(null);
                        onChange(next);
                        setSelectedFieldKeys(new Set());
                      }
                    }}
                  >
                    Group as Front / Rear
                  </button>
                ) : null}
                {sectionSelected.length === 4 ? (
                  <button
                    type="button"
                    className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-sky-200"
                    onClick={() => {
                      const next = assignFieldsToManualLayoutGroup(
                        schema,
                        sectionSelected.map((f) => f.key),
                        "corner4"
                      );
                      if ("error" in next) setLocalError(next.error);
                      else {
                        setLocalError(null);
                        onChange(next);
                        setSelectedFieldKeys(new Set());
                      }
                    }}
                  >
                    Group as FF / FR / RF / RR
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setSelectedFieldKeys((prev) => {
                      const next = new Set(prev);
                      for (const f of sectionSelected) next.delete(f.key);
                      return next;
                    })
                  }
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
          <ul className="mt-2 space-y-1.5">
            {fields.map((f) => {
              const layoutGroup = fieldsInSameManualGroup(schema, f.key);
              return (
              <li
                key={f.key}
                className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                  f.showInSetupSheet && f.showInLogRun && f.showInAnalysis
                    ? "border-border/70 bg-muted/30"
                    : "border-dashed border-border/50 opacity-60"
                } ${selectedFieldKeys.has(f.key) ? "ring-1 ring-sky-500/50" : ""}`}
              >
                {!readOnly ? (
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={selectedFieldKeys.has(f.key)}
                    onChange={(e) => {
                      setSelectedFieldKeys((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(f.key);
                        else next.delete(f.key);
                        return next;
                      });
                    }}
                    aria-label={`Select ${f.displayLabel}`}
                  />
                ) : null}
                <span className="font-medium text-foreground">{f.displayLabel}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{f.key}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{schemaKindFromField(f)}</span>
                {f.universalParameterId ? (
                  <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-mono text-sky-200">
                    ↗ {f.universalParameterId}
                  </span>
                ) : null}
                {f.unit ? <span className="text-[10px] text-muted-foreground">{f.unit}</span> : null}
                {layoutGroup ? (
                  <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200">
                    {layoutGroup.kind === "pair" ? "F/R" : "4-corner"} · {layoutGroup.label}
                  </span>
                ) : null}
                {!layoutKeys.has(f.key) ? (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-200">
                    Not in layout
                  </span>
                ) : null}
                {!readOnly ? (
                  <>
                    {!layoutKeys.has(f.key) ? (
                      <button
                        type="button"
                        className="text-[10px] text-amber-200 hover:underline"
                        onClick={() => {
                          const next = addFieldToLayout(schema, f.key);
                          if ("error" in next) setLocalError(next.error);
                          else {
                            setLocalError(null);
                            onChange(next);
                          }
                        }}
                      >
                        Add to sheet
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => updateField(f.key, { showInSetupSheet: !f.showInSetupSheet })}
                    >
                      {f.showInSetupSheet ? "Hide on sheet" : "Show on sheet"}
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => updateField(f.key, { showInLogRun: !f.showInLogRun })}
                    >
                      {f.showInLogRun ? "Hide from log run" : "Show in log run"}
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={() => updateField(f.key, { showInAnalysis: !f.showInAnalysis })}
                    >
                      {f.showInAnalysis ? "Hide from analysis" : "Show in analysis"}
                    </button>
                    {layoutGroup ? (
                      <button
                        type="button"
                        className="text-[10px] text-violet-200 hover:underline"
                        onClick={() => {
                          const next = ungroupLayoutGroup(schema, layoutGroup.id);
                          if ("error" in next) setLocalError(next.error);
                          else {
                            setLocalError(null);
                            onChange(next);
                          }
                        }}
                      >
                        Ungroup
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-[10px] text-sky-300 hover:underline"
                      onClick={() => setEditingKey(editingKey === f.key ? null : f.key)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-[10px] text-rose-300 hover:underline"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove parameter "${f.displayLabel}"?\n\nThis sheet is shared by every car of this chassis type. Values already logged under "${f.key}" stay stored on past runs but will no longer be shown on setup sheets, compares, or community stats.`
                          )
                        )
                          removeField(f.key);
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
                {editingKey === f.key && !readOnly ? (
                  <FieldEditPanel
                    field={f}
                    isAdmin={isAdmin}
                    layoutGroup={layoutGroup}
                    onSave={(patch) => {
                      updateField(f.key, patch);
                      setEditingKey(null);
                    }}
                    onSaveGroupLabel={
                      layoutGroup
                        ? (label) => {
                            const next = updateLayoutGroupLabel(schema, layoutGroup.id, label);
                            if ("error" in next) setLocalError(next.error);
                            else {
                              setLocalError(null);
                              onChange(next);
                            }
                          }
                        : undefined
                    }
                    onCancel={() => setEditingKey(null)}
                  />
                ) : null}
              </li>
            );
            })}
          </ul>
        </div>
      );
      })}

      {!readOnly ? (
        <div className="rounded-lg border border-sky-500/35 bg-sky-500/5 p-3">
          {!addOpen ? (
            <button
              type="button"
              className="text-xs font-medium text-sky-200 hover:underline"
              onClick={() => setAddOpen(true)}
            >
              + Add parameter
            </button>
          ) : (
            <div className="space-y-3 text-xs">
              <Eyebrow>New parameter</Eyebrow>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-muted-foreground">
                  Label *
                  <input
                    className="rounded border border-border bg-card px-2 py-1.5"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Front ARB"
                  />
                </label>
                <label className="flex flex-col gap-1 text-muted-foreground">
                  Key (optional)
                  <input
                    className="rounded border border-border bg-card px-2 py-1.5 font-mono"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="auto from label"
                  />
                </label>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-muted-foreground">
                  Type
                  <select
                    className="rounded border border-border bg-card px-2 py-1.5"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as SchemaParameterKind)}
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-muted-foreground">
                  Section
                  <select
                    className="rounded border border-border bg-card px-2 py-1.5"
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                  >
                    {SECTION_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-muted-foreground">
                  Unit (optional)
                  <input
                    className="rounded border border-border bg-card px-2 py-1.5"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="mm, °, …"
                  />
                </label>
              </div>
              {(kind === "one_of_many" || kind === "many_of_many") && (
                <div className="space-y-1.5">
                  <div className="text-muted-foreground">
                    Options{" "}
                    <span className="text-[10px]">
                      ({kind === "one_of_many" ? "pick one" : "pick any"}, min 2)
                    </span>
                  </div>
                  <OptionRowsEditor
                    idPrefix="add"
                    options={optionLabels}
                    onChange={setOptionLabels}
                  />
                </div>
              )}
              {addFieldCollisionWarning ? (
                <div className="rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                  {addFieldCollisionWarning}
                </div>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded border border-sky-500/60 bg-sky-500/15 px-3 py-1.5 text-xs font-medium"
                  onClick={addField}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground"
                  onClick={() => {
                    setAddOpen(false);
                    setLocalError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FieldEditPanel(props: {
  field: SetupSheetModelFieldDef;
  /** Admin-only: choose the canonical cross-car parameter by hand. */
  isAdmin?: boolean;
  layoutGroup?: { id: string; label: string } | null;
  onSave: (patch: Partial<SetupSheetModelFieldDef>) => void;
  onSaveGroupLabel?: (label: string) => void;
  onCancel: () => void;
}) {
  const [displayLabel, setDisplayLabel] = useState(props.field.displayLabel);
  const [unit, setUnit] = useState(props.field.unit ?? "");
  const [optionLabels, setOptionLabels] = useState<string[]>(
    props.field.groupedOptionLabels ?? []
  );
  const [universalId, setUniversalId] = useState(props.field.universalParameterId ?? "");
  const [groupLabel, setGroupLabel] = useState(props.layoutGroup?.label ?? "");
  const kind = schemaKindFromField(props.field);

  return (
    <div className="mt-2 w-full basis-full space-y-2 rounded border border-border/80 bg-card p-2">
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
      {props.layoutGroup && props.onSaveGroupLabel ? (
        <label className="block text-[10px] text-muted-foreground">
          Layout group label
          <input
            className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1"
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
          />
        </label>
      ) : null}
      {props.isAdmin ? (
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
            idPrefix={`edit-${props.field.key}`}
            options={optionLabels}
            onChange={setOptionLabels}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-border px-2 py-1 text-[10px]"
          onClick={() => {
            const labels = optionLabels.map((l) => l.trim()).filter(Boolean);
            const patch: Partial<SetupSheetModelFieldDef> = {
              displayLabel: displayLabel.trim() || props.field.displayLabel,
              unit: unit.trim() || undefined,
              universalParameterId: universalId.trim() || undefined,
            };
            if (kind === "one_of_many" || kind === "many_of_many") {
              if (labels.length >= 2) {
                patch.groupedOptionLabels = labels;
                patch.groupedOptionValues = labels.map((l, i) => groupedOptionValueFromLabel(l, i));
              }
            }
            props.onSave(patch);
            if (props.layoutGroup && props.onSaveGroupLabel && groupLabel.trim()) {
              props.onSaveGroupLabel(groupLabel);
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

