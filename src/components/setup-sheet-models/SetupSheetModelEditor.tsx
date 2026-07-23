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

const SECTION_PRESETS = CUSTOM_FIELD_SECTION_PRESETS.filter((p) =>
  ["suspension", "drivetrain", "tyres_body", "tuning", "platform_chassis", "other"].includes(p.id)
);

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
  const [sectionId, setSectionId] = useState("tuning");
  const [unit, setUnit] = useState("");
  const [optionLabels, setOptionLabels] = useState<string[]>([]);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  const fieldByKey = useMemo(() => {
    const m = new Map<string, SetupSheetModelFieldDef>();
    for (const f of schema.fields) m.set(f.key, f);
    return m;
  }, [schema.fields]);

  const tray = useMemo(() => unplacedFields(schema), [schema]);

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
    const inferredUniversalId = suggestUniversalParameterId(built.key, built.displayLabel);
    const nextFields = [
      ...schema.fields,
      inferredUniversalId ? { ...built, universalParameterId: inferredUniversalId } : built,
    ];
    // Creating a parameter places it on the sheet immediately — no separate "add to sheet" step.
    onChange(placeMissingParameters({ ...schema, fields: nextFields }));
    setLabelText("");
    setKeyText("");
    setOptionLabels([]);
    setAddOpen(false);
  }, [schema, onChange, label, key, kind, sectionId, unit, optionLabels]);

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
                  <Eyebrow>New parameter</Eyebrow>
                  <label className="flex flex-col gap-1 text-muted-foreground">
                    Label *
                    <input
                      className="rounded border border-border bg-card px-2 py-1.5"
                      value={label}
                      onChange={(e) => setLabelText(e.target.value)}
                      placeholder="e.g. Front ARB"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-muted-foreground">
                    Key (optional)
                    <input
                      className="rounded border border-border bg-card px-2 py-1.5 font-mono"
                      value={key}
                      onChange={(e) => setKeyText(e.target.value)}
                      placeholder={keyPreview || "auto from label"}
                    />
                  </label>
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
        </aside>

        {/* -------------------------------------------------------- CANVAS */}
        <div className="min-w-0 space-y-3">
          {schema.structuredSections.map((sec) => {
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
                    {!readOnly && sec.id !== "other" ? (
                      <button
                        type="button"
                        className="text-[10px] text-rose-300 hover:underline"
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
              className="ml-auto shrink-0 text-[10px] text-rose-300 hover:underline"
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
