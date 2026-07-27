"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CUSTOM_FIELD_SECTION_PRESETS,
  suggestKeyFromPdfFieldName,
} from "@/lib/setupCalibrations/customFieldCatalog";
import {
  buildFieldDefFromKind,
  schemaKindFromField,
  type SchemaParameterKind,
} from "@/lib/setupSheetModels/fieldParamTypes";
import { suggestUniversalParameterId } from "@/lib/setupSheetModels/matchUniversalParameter";
import { awesomatixFieldKeyCollisionWarning } from "@/lib/setupSheetModels/awesomatixFieldKeyCollision";
import {
  addSection,
  appendFieldToGroup,
  assignFieldToSlot,
  deleteSection,
  makeSlotsGroup,
  moveFieldToSection,
  moveRow,
  moveSection,
  placeMissingParameters,
  removeRowToTray,
  removeSlot,
  renameSection,
  setGroupRowLabel,
  unplacedFields,
} from "@/lib/setupSheetModels/layoutCanvasOps";
import {
  MAX_LAYOUT_SLOTS,
  MIN_LAYOUT_SLOTS,
  type SetupSheetModelFieldDef,
  type SetupSheetModelLayoutRow,
  type SetupSheetModelSchema,
} from "@/lib/setupSheetModels/types";
import { OptionRowsEditor } from "@/components/setup-sheet-models/OptionRowsEditor";
import { FieldDefEditor } from "@/components/setup-sheet-models/FieldDefEditor";
import { Eyebrow } from "@/components/ui/panel";

const KIND_OPTIONS: { value: SchemaParameterKind; label: string }[] = [
  { value: "number", label: "Number" },
  { value: "text", label: "Text / notes" },
  { value: "checkbox", label: "Checkbox" },
  { value: "one_of_many", label: "One of many (pick one)" },
  { value: "many_of_many", label: "Many of many" },
];

/**
 * Sections offered when adding a parameter: the ones actually on *this* sheet first, then any
 * presets not already there.
 *
 * The old list filtered `CUSTOM_FIELD_SECTION_PRESETS` for six ids, two of which ("suspension",
 * "tyres_body") don't exist in it — so it silently offered four generic sections and none of the
 * sheet's own. A parameter could not be added into "Front end" even though the canvas was full of
 * them, so every new one landed in the wrong place and had to be dragged out.
 */
function sectionOptionsFor(schema: SetupSheetModelSchema): { id: string; title: string }[] {
  const seen = new Set<string>();
  const out: { id: string; title: string }[] = [];
  for (const sec of schema.structuredSections) {
    if (seen.has(sec.id)) continue;
    seen.add(sec.id);
    out.push({ id: sec.id, title: sec.title || sec.id });
  }
  for (const f of schema.fields) {
    if (!f.sectionId || seen.has(f.sectionId)) continue;
    seen.add(f.sectionId);
    out.push({ id: f.sectionId, title: f.sectionTitle || f.sectionId });
  }
  for (const p of CUSTOM_FIELD_SECTION_PRESETS) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Sentinel option that reveals the inline "new section" input, as TireTypeCombobox does. */
const NEW_SECTION_VALUE = "__new_section__";

type OpResult = SetupSheetModelSchema | { error: string };

type Drag =
  | { type: "row"; sectionId: string; rowIndex: number }
  | { type: "section"; sectionId: string }
  | { type: "tray"; key: string };

type Editing = { sectionId: string; rowIndex: number; fieldKey: string };

/** {label, key} cells for a group-like row; null for single / fixed rows. */
function rowMembers(row: SetupSheetModelLayoutRow): { label: string; key: string }[] | null {
  if (row.type === "slots") return row.slots;
  if (row.type === "pair") {
    return [
      { label: "Front", key: row.leftKey },
      { label: "Rear", key: row.rightKey },
    ];
  }
  if (row.type === "corner4") {
    return [
      { label: "FF", key: row.ff },
      { label: "FR", key: row.fr },
      { label: "RF", key: row.rf },
      { label: "RR", key: row.rr },
    ];
  }
  return null;
}

function rowHeading(row: SetupSheetModelLayoutRow, fieldByKey: Map<string, SetupSheetModelFieldDef>): string {
  if (row.type === "single") return fieldByKey.get(row.key)?.displayLabel || row.label || row.key;
  if (row.type === "screw_strip") return row.label || row.key;
  if (row.type === "top_deck_block") return "Top deck block";
  return row.label || "Group";
}

/**
 * The unified, layout-first setup-sheet editor. The canvas on the right *is* the sheet — sections,
 * rows and groups, arranged the way drivers see them; clicking a row edits its parameter definition
 * inline. The tray on the left holds parameters not on the sheet (removed, or log-run/analysis-only)
 * — drag one onto the canvas to place it. Creating a parameter puts it on the sheet immediately;
 * there is no separate "add to sheet" step. Every mutation routes through `layoutCanvasOps`.
 */
export function SetupSheetModelEditor(props: {
  schema: SetupSheetModelSchema;
  onChange: (schema: SetupSheetModelSchema) => void;
  readOnly?: boolean;
  /** Admins pick a field's canonical cross-car parameter by hand; hidden for everyone else. */
  isAdmin?: boolean;
}) {
  const { schema, onChange } = props;
  const readOnly = props.readOnly === true;
  const isAdmin = props.isAdmin === true;

  const [drag, setDrag] = useState<Drag | null>(null);
  const [rowDrop, setRowDrop] = useState<{ sectionId: string; rowIndex: number; edge: "above" | "below" } | null>(null);
  const [secDrop, setSecDrop] = useState<{ sectionId: string; edge: "above" | "below" } | null>(null);
  const [slotDrop, setSlotDrop] = useState<{ sectionId: string; rowIndex: number; slotIndex: number } | null>(null);
  const [endDrop, setEndDrop] = useState<string | null>(null);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [trayEditing, setTrayEditing] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);

  // Add-parameter form.
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabelText] = useState("");
  const [key, setKeyText] = useState("");
  const [kind, setKind] = useState<SchemaParameterKind>("number");
  const [sectionId, setSectionId] = useState("");
  const [unit, setUnit] = useState("");
  const [optionLabels, setOptionLabels] = useState<string[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  /** Inline section creation from inside the add form, without leaving it. */
  const [addSectionTitle, setAddSectionTitle] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const addLabelRef = useRef<HTMLInputElement | null>(null);

  const fieldByKey = useMemo(() => {
    const m = new Map<string, SetupSheetModelFieldDef>();
    for (const f of schema.fields) m.set(f.key, f);
    return m;
  }, [schema.fields]);

  const tray = useMemo(() => unplacedFields(schema), [schema]);
  const sectionOptions = useMemo(() => sectionOptionsFor(schema), [schema]);
  /** Default to the section last added into, else the first one on the sheet. */
  const effectiveSectionId =
    sectionId || sectionOptions[0]?.id || CUSTOM_FIELD_SECTION_PRESETS[0]!.id;

  const applySchema = useCallback(
    (next: OpResult) => {
      if ("error" in next) {
        setLocalError(next.error);
        return;
      }
      setLocalError(null);
      onChange(next);
    },
    [onChange]
  );

  const updateField = useCallback(
    (fieldKey: string, patch: Partial<SetupSheetModelFieldDef>) => {
      onChange({
        ...schema,
        fields: schema.fields.map((f) => (f.key === fieldKey ? { ...f, ...patch } : f)),
      });
    },
    [schema, onChange]
  );

  const clearDrag = useCallback(() => {
    setDrag(null);
    setRowDrop(null);
    setSecDrop(null);
    setSlotDrop(null);
    setEndDrop(null);
  }, []);

  const draggedSingleKey = useCallback((): string | null => {
    if (drag?.type === "tray") return drag.key;
    if (drag?.type === "row") {
      const row = schema.structuredSections.find((s) => s.id === drag.sectionId)?.rows[drag.rowIndex];
      if (row && row.type === "single") return row.key;
    }
    return null;
  }, [drag, schema]);

  // ----- selection / grouping -----
  const selectedKeys = useMemo(() => {
    const keys: string[] = [];
    for (const id of selectedRows) {
      const [secId, idxStr] = id.split("|");
      const row = schema.structuredSections.find((s) => s.id === secId)?.rows[Number(idxStr)];
      if (row?.type === "single") keys.push(row.key);
    }
    return keys;
  }, [selectedRows, schema]);

  const groupSelected = useCallback(() => {
    applySchema(makeSlotsGroup(schema, selectedKeys));
    setSelectedRows(new Set());
  }, [applySchema, schema, selectedKeys]);

  const ungroupRow = useCallback(
    (secId: string, rowIndex: number) => {
      let next: SetupSheetModelSchema = schema;
      // Peel the last slot off until the row is no longer a group (each survivor becomes a single row).
      for (let guard = 0; guard <= MAX_LAYOUT_SLOTS; guard++) {
        const row = next.structuredSections.find((s) => s.id === secId)?.rows[rowIndex];
        const members = row ? rowMembers(row) : null;
        if (!row || !members) break;
        const res = removeSlot(next, secId, rowIndex, members.length - 1);
        if ("error" in res) break;
        next = res;
      }
      applySchema(next);
    },
    [applySchema, schema]
  );

  const addField = useCallback(() => {
    setLocalError(null);
    const sec =
      sectionOptions.find((p) => p.id === effectiveSectionId) ?? sectionOptions[0] ?? { id: "other", title: "Other" };
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
    const inferredUniversalId = suggestUniversalParameterId(built.key, built.displayLabel);
    const nextFields = [
      ...schema.fields,
      inferredUniversalId ? { ...built, universalParameterId: inferredUniversalId } : built,
    ];
    // Creating a parameter places it on the sheet immediately — no separate "add to sheet" step.
    onChange(placeMissingParameters({ ...schema, fields: nextFields }));
    // Stay open for the next one: adding parameters is a run of them, and re-opening the form and
    // clicking back into Label cost two dead clicks each time. Section/Type carry over on purpose;
    // unit does not — mm silently inherited onto a degrees or shim-count parameter.
    setLabelText("");
    setKeyText("");
    setUnit("");
    setOptionLabels([]);
    setAddedCount((n) => n + 1);
    addLabelRef.current?.focus();
  }, [schema, onChange, label, key, kind, effectiveSectionId, sectionOptions, unit, optionLabels]);

  const keyPreview = key.trim() || (label.trim() ? suggestKeyFromPdfFieldName(label.trim()) : "");
  const collisionWarning = awesomatixFieldKeyCollisionWarning(keyPreview, kind);

  // ------------------------------------------------------------------ render

  return (
    <div className="space-y-3">
      {localError ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {localError}
        </div>
      ) : null}

      {!readOnly && selectedKeys.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{selectedKeys.length} selected</span>
          <button
            type="button"
            disabled={selectedKeys.length < MIN_LAYOUT_SLOTS || selectedKeys.length > MAX_LAYOUT_SLOTS}
            className="rounded border border-sky-500/50 bg-sky-500/15 px-2 py-0.5 text-sky-100 disabled:opacity-40"
            onClick={groupSelected}
          >
            Group into one row
          </button>
          <span className="text-[10px] text-muted-foreground">
            (pick {MIN_LAYOUT_SLOTS}–{MAX_LAYOUT_SLOTS})
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedRows(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(200px,16rem)_1fr]">
        {/* ---------------------------------------------------------- TRAY */}
        <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
          <div>
            <Eyebrow>Not on the sheet</Eyebrow>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Parameters you removed, or that only show on Log run / Analysis. Drag one onto the sheet to place it.
            </p>
          </div>

          {tray.length === 0 ? (
            <p className="rounded border border-dashed border-border/60 px-2 py-3 text-[11px] text-muted-foreground">
              Everything is on the sheet.
            </p>
          ) : (
            <ul className="space-y-1">
              {tray.map((f) => (
                <li key={f.key}>
                  <div
                    className={`flex items-center gap-1.5 rounded border border-border/70 bg-muted/30 px-2 py-1.5 text-xs ${
                      readOnly ? "" : "cursor-grab"
                    } ${drag?.type === "tray" && drag.key === f.key ? "opacity-60" : ""}`}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      setDrag({ type: "tray", key: f.key });
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={clearDrag}
                  >
                    {!readOnly ? <span className="select-none text-muted-foreground">⠿</span> : null}
                    <span className="min-w-0 flex-1 truncate font-medium">{f.displayLabel}</span>
                    <span className="rounded bg-muted px-1 py-0.5 text-[9px]">{schemaKindFromField(f)}</span>
                    {!readOnly ? (
                      <button
                        type="button"
                        className="text-[10px] text-sky-300 hover:underline"
                        onClick={() => setTrayEditing(trayEditing === f.key ? null : f.key)}
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                  {trayEditing === f.key && !readOnly ? (
                    <FieldDefEditor
                      field={f}
                      isAdmin={isAdmin}
                      onSave={(patch) => {
                        updateField(f.key, patch);
                        setTrayEditing(null);
                      }}
                      onCancel={() => setTrayEditing(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {!readOnly && tray.length > 0 ? (
            <button
              type="button"
              className="rounded border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => applySchema(placeMissingParameters(schema))}
            >
              Place all on sheet
            </button>
          ) : null}

          {/* Add parameter */}
          {!readOnly ? (
            <div className="rounded-lg border border-sky-500/35 bg-sky-500/5 p-2">
              {!addOpen ? (
                <button
                  type="button"
                  className="text-xs font-medium text-sky-200 hover:underline"
                  onClick={() => setAddOpen(true)}
                >
                  + Add parameter
                </button>
              ) : (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <Eyebrow>New parameter</Eyebrow>
                    {addedCount > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {addedCount} added
                      </span>
                    ) : null}
                  </div>
                  <label className="flex flex-col gap-1 text-muted-foreground">
                    Label *
                    <input
                      ref={addLabelRef}
                      className="rounded border border-border bg-card px-2 py-1.5"
                      value={label}
                      onChange={(e) => setLabelText(e.target.value)}
                      // Enter adds and refocuses here, so a run of parameters never needs the mouse.
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addField();
                        }
                      }}
                      placeholder="e.g. Front ARB"
                      autoFocus
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-muted-foreground">
                    Section
                    <select
                      className="rounded border border-border bg-card px-2 py-1.5"
                      value={effectiveSectionId}
                      onChange={(e) => {
                        if (e.target.value === NEW_SECTION_VALUE) {
                          setAddSectionTitle("");
                          return;
                        }
                        setSectionId(e.target.value);
                      }}
                    >
                      {sectionOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                      <option value={NEW_SECTION_VALUE}>+ New section…</option>
                    </select>
                  </label>
                  {addSectionTitle !== "" || sectionOptions.length === 0 ? (
                    <div className="flex gap-1">
                      <input
                        className="min-w-0 flex-1 rounded border border-border bg-card px-2 py-1.5"
                        value={addSectionTitle}
                        onChange={(e) => setAddSectionTitle(e.target.value)}
                        placeholder="New section name"
                      />
                      <button
                        type="button"
                        className="rounded border border-border px-2 py-1 text-[11px]"
                        disabled={!addSectionTitle.trim()}
                        onClick={() => {
                          const next = addSection(schema, addSectionTitle.trim());
                          if ("error" in next) {
                            setLocalError(next.error);
                            return;
                          }
                          const created = next.structuredSections.find(
                            (s) => !schema.structuredSections.some((o) => o.id === s.id)
                          );
                          applySchema(next);
                          if (created) setSectionId(created.id);
                          setAddSectionTitle("");
                        }}
                      >
                        Create
                      </button>
                    </div>
                  ) : null}
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
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer text-[11px]">Key and unit</summary>
                    <div className="mt-1 space-y-2">
                      <label className="flex flex-col gap-1">
                        Key (optional)
                        <input
                          className="rounded border border-border bg-card px-2 py-1.5 font-mono"
                          value={key}
                          onChange={(e) => setKeyText(e.target.value)}
                          placeholder={keyPreview || "auto from label"}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        Unit (optional)
                        <input
                          className="rounded border border-border bg-card px-2 py-1.5"
                          value={unit}
                          onChange={(e) => setUnit(e.target.value)}
                          placeholder="mm, °, …"
                        />
                      </label>
                    </div>
                  </details>
                  {(kind === "one_of_many" || kind === "many_of_many") && (
                    <div className="space-y-1.5">
                      <div className="text-muted-foreground">
                        Options{" "}
                        <span className="text-[10px]">
                          ({kind === "one_of_many" ? "pick one" : "pick any"}, min 2)
                        </span>
                      </div>
                      <OptionRowsEditor idPrefix="add" options={optionLabels} onChange={setOptionLabels} />
                    </div>
                  )}
                  {collisionWarning ? (
                    <div className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-100">
                      {collisionWarning}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-sky-500/60 bg-sky-500/15 px-3 py-1.5 text-xs font-medium"
                      onClick={addField}
                    >
                      Add to sheet
                    </button>
                    <button
                      type="button"
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground"
                      onClick={() => {
                        setAddOpen(false);
                        setAddedCount(0);
                        setLocalError(null);
                      }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </aside>

        {/* -------------------------------------------------------- CANVAS */}
        <div className="min-w-0 space-y-3">
          {schema.structuredSections.map((sec, secIdx) => {
            const showSecAbove = secDrop?.sectionId === sec.id && secDrop.edge === "above";
            const showSecBelow = secDrop?.sectionId === sec.id && secDrop.edge === "below";
            return (
              <div key={sec.id} className="relative">
                {showSecAbove ? (
                  <div className="pointer-events-none absolute -top-1 left-0 right-0 h-0.5 bg-sky-400/80" />
                ) : null}
                <div
                  className={`rounded-lg border bg-card/80 p-3 ${
                    drag?.type === "section" && drag.sectionId === sec.id ? "border-sky-500/40 opacity-60" : "border-border"
                  }`}
                  draggable={!readOnly}
                  onDragStart={(e) => {
                    if (readOnly) return;
                    setDrag({ type: "section", sectionId: sec.id });
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(e) => {
                    if (drag?.type !== "section" || drag.sectionId === sec.id) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const edge: "above" | "below" = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                    setSecDrop({ sectionId: sec.id, edge });
                  }}
                  onDrop={(e) => {
                    if (drag?.type !== "section") return;
                    e.preventDefault();
                    const edge = secDrop?.edge ?? "below";
                    const fromIdx = schema.structuredSections.findIndex((s) => s.id === drag.sectionId);
                    const toIdx0 = schema.structuredSections.findIndex((s) => s.id === sec.id);
                    let newIdx = toIdx0 + (edge === "below" ? 1 : 0);
                    if (fromIdx < newIdx) newIdx -= 1;
                    applySchema(moveSection(schema, fromIdx, newIdx));
                    clearDrag();
                  }}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {!readOnly ? (
                      <span className="cursor-grab select-none text-muted-foreground" title="Drag section">
                        ⠿
                      </span>
                    ) : null}
                    {!readOnly ? (
                      <input
                        className="ui-title min-w-0 flex-1 rounded border border-border bg-card px-2 py-0.5 text-xs"
                        value={sec.title}
                        onChange={(e) => applySchema(renameSection(schema, sec.id, e.target.value))}
                        onDragStart={(e) => e.preventDefault()}
                      />
                    ) : (
                      <Eyebrow>{sec.title}</Eyebrow>
                    )}
                    {/* Section reorder without dragging — the only path that works on touch. */}
                    {!readOnly ? (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="min-h-6 min-w-6 rounded border border-border text-[11px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                          onClick={() => applySchema(moveSection(schema, secIdx, secIdx - 1))}
                          disabled={secIdx === 0}
                          aria-label={`Move section ${sec.title} up`}
                          title="Move section up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="min-h-6 min-w-6 rounded border border-border text-[11px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                          onClick={() => applySchema(moveSection(schema, secIdx, secIdx + 1))}
                          disabled={secIdx >= schema.structuredSections.length - 1}
                          aria-label={`Move section ${sec.title} down`}
                          title="Move section down"
                        >
                          ↓
                        </button>
                      </span>
                    ) : null}
                    {!readOnly && sec.id !== "other" ? (
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-rose-300 hover:underline"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete section "${sec.title}"? Its parameters move to Other — nothing is deleted.`
                            )
                          )
                            applySchema(deleteSection(schema, sec.id));
                        }}
                      >
                        Delete section
                      </button>
                    ) : null}
                  </div>

                  <ul className="space-y-1">
                    {sec.rows.map((row, rowIdx) => (
                      <RowItem
                        key={`${sec.id}|${rowIdx}`}
                        sectionId={sec.id}
                        row={row}
                        rowIndex={rowIdx}
                        readOnly={readOnly}
                        isAdmin={isAdmin}
                        fieldByKey={fieldByKey}
                        drag={drag}
                        rowDrop={rowDrop}
                        slotDrop={slotDrop}
                        selectedRows={selectedRows}
                        editing={editing}
                        schema={schema}
                        setDrag={setDrag}
                        setRowDrop={setRowDrop}
                        setSlotDrop={setSlotDrop}
                        clearDrag={clearDrag}
                        draggedSingleKey={draggedSingleKey}
                        applySchema={applySchema}
                        updateField={updateField}
                        setSelectedRows={setSelectedRows}
                        setEditing={setEditing}
                        ungroupRow={ungroupRow}
                      />
                    ))}

                    {/* Append / empty-section drop zone */}
                    {!readOnly ? (
                      <li
                        className={`rounded border border-dashed px-2 py-1.5 text-center text-[10px] ${
                          endDrop === sec.id
                            ? "border-sky-400/80 bg-sky-500/10 text-sky-200"
                            : "border-border/40 text-muted-foreground/60"
                        }`}
                        onDragOver={(e) => {
                          if (drag?.type !== "row" && drag?.type !== "tray") return;
                          e.preventDefault();
                          e.stopPropagation();
                          setEndDrop(sec.id);
                        }}
                        onDragLeave={() => setEndDrop((cur) => (cur === sec.id ? null : cur))}
                        onDrop={(e) => {
                          if (drag?.type !== "row" && drag?.type !== "tray") return;
                          e.preventDefault();
                          e.stopPropagation();
                          if (drag.type === "row") {
                            applySchema(moveRow(schema, drag.sectionId, drag.rowIndex, sec.id, sec.rows.length));
                          } else {
                            applySchema(moveFieldToSection(schema, drag.key, sec.id, sec.rows.length));
                          }
                          clearDrag();
                        }}
                      >
                        {sec.rows.length === 0 ? "Drag a parameter here" : "＋ drop to add to this section"}
                      </li>
                    ) : null}
                  </ul>
                </div>
                {showSecBelow ? (
                  <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 bg-sky-400/80" />
                ) : null}
              </div>
            );
          })}

          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="rounded border border-border bg-card px-2 py-1 text-xs"
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                placeholder="New section title"
              />
              <button
                type="button"
                className="rounded border border-border bg-muted/40 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => {
                  if (!newSectionTitle.trim()) return;
                  applySchema(addSection(schema, newSectionTitle));
                  setNewSectionTitle("");
                }}
              >
                + Add section
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One canvas row: drag-reorder, click-to-edit, group cells as slot drop targets. */
function RowItem(props: {
  sectionId: string;
  row: SetupSheetModelLayoutRow;
  rowIndex: number;
  readOnly: boolean;
  isAdmin: boolean;
  fieldByKey: Map<string, SetupSheetModelFieldDef>;
  drag: Drag | null;
  rowDrop: { sectionId: string; rowIndex: number; edge: "above" | "below" } | null;
  slotDrop: { sectionId: string; rowIndex: number; slotIndex: number } | null;
  selectedRows: Set<string>;
  editing: Editing | null;
  schema: SetupSheetModelSchema;
  setDrag: (d: Drag | null) => void;
  setRowDrop: (d: { sectionId: string; rowIndex: number; edge: "above" | "below" } | null) => void;
  setSlotDrop: (d: { sectionId: string; rowIndex: number; slotIndex: number } | null) => void;
  clearDrag: () => void;
  draggedSingleKey: () => string | null;
  applySchema: (next: OpResult) => void;
  updateField: (key: string, patch: Partial<SetupSheetModelFieldDef>) => void;
  setSelectedRows: (fn: (prev: Set<string>) => Set<string>) => void;
  setEditing: (e: Editing | null) => void;
  ungroupRow: (sectionId: string, rowIndex: number) => void;
}) {
  const {
    sectionId,
    row,
    rowIndex,
    readOnly,
    isAdmin,
    fieldByKey,
    drag,
    rowDrop,
    slotDrop,
    selectedRows,
    editing,
    schema,
    setDrag,
    setRowDrop,
    setSlotDrop,
    clearDrag,
    draggedSingleKey,
    applySchema,
    updateField,
    setSelectedRows,
    setEditing,
    ungroupRow,
  } = props;

  const rowId = `${sectionId}|${rowIndex}`;
  const rowCount = schema.structuredSections.find((s) => s.id === sectionId)?.rows.length ?? 0;
  const members = rowMembers(row);
  const isGroup = members != null;
  const isSingle = row.type === "single";
  const isFixed = row.type === "screw_strip" || row.type === "top_deck_block";
  const showAbove = rowDrop?.sectionId === sectionId && rowDrop.rowIndex === rowIndex && rowDrop.edge === "above";
  const showBelow = rowDrop?.sectionId === sectionId && rowDrop.rowIndex === rowIndex && rowDrop.edge === "below";
  const editingHere = editing?.sectionId === sectionId && editing.rowIndex === rowIndex;
  const editingField = editingHere ? fieldByKey.get(editing!.fieldKey) : undefined;

  function openEdit(fieldKey: string) {
    if (readOnly) return;
    setEditing(editingHere && editing!.fieldKey === fieldKey ? null : { sectionId, rowIndex, fieldKey });
  }

  return (
    <li className="relative">
      {showAbove ? (
        <div className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 bg-sky-400/80" />
      ) : null}
      <div
        className={`rounded border px-2 py-1.5 text-xs ${
          drag?.type === "row" && drag.sectionId === sectionId && drag.rowIndex === rowIndex
            ? "border-sky-500/40 bg-sky-500/5 opacity-70"
            : "border-border/70 bg-muted/20"
        }`}
        draggable={!readOnly}
        onDragStart={(e) => {
          if (readOnly) return;
          e.stopPropagation();
          setDrag({ type: "row", sectionId, rowIndex });
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={clearDrag}
        onDragOver={(e) => {
          if (drag?.type !== "row" && drag?.type !== "tray") return;
          e.preventDefault();
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const edge: "above" | "below" = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
          setRowDrop({ sectionId, rowIndex, edge });
        }}
        onDrop={(e) => {
          if (drag?.type !== "row" && drag?.type !== "tray") return;
          e.preventDefault();
          e.stopPropagation();
          const edge = rowDrop?.edge ?? "below";
          const toIndex = rowIndex + (edge === "below" ? 1 : 0);
          if (drag.type === "row") {
            applySchema(moveRow(schema, drag.sectionId, drag.rowIndex, sectionId, toIndex));
          } else {
            applySchema(moveFieldToSection(schema, drag.key, sectionId, toIndex));
          }
          clearDrag();
        }}
      >
        <div className="flex items-center gap-2">
          {!readOnly ? <span className="shrink-0 cursor-grab select-none text-muted-foreground">⠿</span> : null}
          {!readOnly && isSingle ? (
            <input
              type="checkbox"
              className="shrink-0"
              checked={selectedRows.has(rowId)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                setSelectedRows((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(rowId);
                  else next.delete(rowId);
                  return next;
                })
              }
              aria-label="Select row for grouping"
            />
          ) : null}

          {isSingle ? (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-medium hover:text-sky-200"
              onClick={() => openEdit(row.key)}
              disabled={readOnly}
            >
              {rowHeading(row, fieldByKey)}
            </button>
          ) : (
            <span className="min-w-0 truncate font-medium">{rowHeading(row, fieldByKey)}</span>
          )}

          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{row.type}</span>

          {/* Drag is mouse-only (HTML5 DnD never fires on touch), so every reorder also has a
              button path — the only way this works on a phone, and faster than dragging anyway. */}
          {!readOnly ? (
            <span className="ml-auto flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="min-h-6 min-w-6 rounded border border-border text-[11px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                onClick={() => applySchema(moveRow(schema, sectionId, rowIndex, sectionId, rowIndex - 1))}
                disabled={rowIndex === 0}
                aria-label={`Move ${rowHeading(row, fieldByKey)} up`}
                title="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                className="min-h-6 min-w-6 rounded border border-border text-[11px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-30"
                onClick={() => applySchema(moveRow(schema, sectionId, rowIndex, sectionId, rowIndex + 1))}
                disabled={rowIndex >= rowCount - 1}
                aria-label={`Move ${rowHeading(row, fieldByKey)} down`}
                title="Move down"
              >
                ↓
              </button>
              <select
                className="min-h-6 rounded border border-border bg-card px-1 text-[10px] text-muted-foreground"
                value=""
                onChange={(e) => {
                  const toSection = e.target.value;
                  if (!toSection) return;
                  const target = schema.structuredSections.find((s) => s.id === toSection);
                  applySchema(
                    moveRow(schema, sectionId, rowIndex, toSection, target?.rows.length ?? 0)
                  );
                }}
                aria-label={`Move ${rowHeading(row, fieldByKey)} to another section`}
                title="Move to section"
              >
                <option value="">→</option>
                {schema.structuredSections
                  .filter((s) => s.id !== sectionId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title || s.id}
                    </option>
                  ))}
              </select>
            </span>
          ) : null}

          {!readOnly && isGroup ? (
            <button
              type="button"
              className="shrink-0 text-[10px] text-violet-200 hover:underline"
              onClick={() => ungroupRow(sectionId, rowIndex)}
            >
              Ungroup
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              className="shrink-0 text-[10px] text-rose-300 hover:underline"
              onClick={() => applySchema(removeRowToTray(schema, sectionId, rowIndex))}
            >
              Remove
            </button>
          ) : null}
        </div>

        {/* Group member cells — each is a slot drop target and an edit affordance. */}
        {members ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5 pl-6">
            {members.map((m, slotIdx) => {
              const f = fieldByKey.get(m.key);
              const highlight =
                slotDrop?.sectionId === sectionId && slotDrop.rowIndex === rowIndex && slotDrop.slotIndex === slotIdx;
              return (
                <button
                  key={`${m.key}:${slotIdx}`}
                  type="button"
                  disabled={readOnly}
                  className={`flex flex-col items-start rounded border px-1.5 py-1 text-left ${
                    highlight ? "border-sky-400/80 bg-sky-500/15" : "border-border/60 bg-card/60"
                  } ${editingHere && editing!.fieldKey === m.key ? "ring-1 ring-sky-400/70" : ""}`}
                  onClick={() => openEdit(m.key)}
                  onDragOver={(e) => {
                    const k = draggedSingleKey();
                    if (!k) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setSlotDrop({ sectionId, rowIndex, slotIndex: slotIdx });
                  }}
                  onDrop={(e) => {
                    const k = draggedSingleKey();
                    if (!k) return;
                    e.preventDefault();
                    e.stopPropagation();
                    applySchema(assignFieldToSlot(schema, sectionId, rowIndex, slotIdx, k));
                    clearDrag();
                  }}
                >
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{m.label || "—"}</span>
                  <span className="text-[11px] font-medium">{f?.displayLabel ?? m.key}</span>
                </button>
              );
            })}
            {/* Append slot */}
            {!readOnly && members.length < MAX_LAYOUT_SLOTS ? (
              <div
                className="flex items-center justify-center rounded border border-dashed border-border/50 px-2 text-[11px] text-muted-foreground"
                onDragOver={(e) => {
                  const k = draggedSingleKey();
                  if (!k) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  const k = draggedSingleKey();
                  if (!k) return;
                  e.preventDefault();
                  e.stopPropagation();
                  applySchema(appendFieldToGroup(schema, sectionId, rowIndex, k));
                  clearDrag();
                }}
              >
                ＋
              </div>
            ) : null}
          </div>
        ) : null}

        {isFixed ? (
          <p className="mt-1 pl-6 text-[10px] text-muted-foreground">Fixed layout block — reorder or remove only.</p>
        ) : null}

        {editingHere && editingField && !readOnly ? (
          <FieldDefEditor
            field={editingField}
            isAdmin={isAdmin}
            groupLabel={
              row.type === "slots" || row.type === "pair" || row.type === "corner4" ? row.label : null
            }
            onSave={(patch) => {
              updateField(editingField.key, patch);
              setEditing(null);
            }}
            onSaveGroupLabel={
              isGroup
                ? (lbl) => applySchema(setGroupRowLabel(schema, sectionId, rowIndex, lbl))
                : undefined
            }
            onCancel={() => setEditing(null)}
          />
        ) : null}
      </div>
      {showBelow ? (
        <div className="pointer-events-none absolute -bottom-0.5 left-0 right-0 h-0.5 bg-sky-400/80" />
      ) : null}
    </li>
  );
}
