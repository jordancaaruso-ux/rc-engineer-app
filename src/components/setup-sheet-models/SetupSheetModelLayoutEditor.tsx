"use client";

import { useCallback, useMemo, useState } from "react";
import {
  groupLayoutRows,
  inferStructuredLayoutFromFields,
  ungroupLayoutRow,
  updateLayoutGroupLabel,
} from "@/lib/setupSheetModels/layoutGroupOps";
import {
  addFieldToLayout,
  fieldsNotInLayout,
  removeRowFromLayout,
  renameSectionTitle,
  reorderRow,
  reorderSections,
  rowLabel,
} from "@/lib/setupSheetModels/layoutEditorOps";
import type { SetupSheetModelSchema } from "@/lib/setupSheetModels/types";
import { Eyebrow } from "@/components/ui/panel";

type RowDragId = `${string}:${number}`;
type SectionDragId = `section:${string}`;

function parseRowDragId(id: RowDragId): { sectionId: string; rowIndex: number } | null {
  const idx = id.lastIndexOf(":");
  if (idx <= 0) return null;
  const sectionId = id.slice(0, idx);
  const rowIndex = Number(id.slice(idx + 1));
  if (!Number.isFinite(rowIndex)) return null;
  return { sectionId, rowIndex };
}

export function SetupSheetModelLayoutEditor(props: {
  schema: SetupSheetModelSchema;
  onChange: (schema: SetupSheetModelSchema) => void;
  readOnly?: boolean;
}) {
  const { schema, onChange, readOnly } = props;
  const [draggingRow, setDraggingRow] = useState<RowDragId | null>(null);
  const [rowDropTarget, setRowDropTarget] = useState<{ id: RowDragId; edge: "above" | "below" } | null>(null);
  const [draggingSection, setDraggingSection] = useState<SectionDragId | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<{
    id: SectionDragId;
    edge: "above" | "below";
  } | null>(null);
  const [addFieldKey, setAddFieldKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<RowDragId>>(new Set());

  const notInLayout = useMemo(() => fieldsNotInLayout(schema), [schema]);

  const applySchema = useCallback(
    (next: SetupSheetModelSchema | { error: string }) => {
      if ("error" in next) {
        setLocalError(next.error);
        return;
      }
      setLocalError(null);
      onChange(next);
    },
    [onChange]
  );

  const commitRowReorder = useCallback(
    (dragged: RowDragId, target: RowDragId, edge: "above" | "below") => {
      const from = parseRowDragId(dragged);
      const to = parseRowDragId(target);
      if (!from || !to || from.sectionId !== to.sectionId) return;
      let toIndex = to.rowIndex + (edge === "below" ? 1 : 0);
      if (from.rowIndex < toIndex) toIndex -= 1;
      applySchema(reorderRow(schema, from.sectionId, from.rowIndex, toIndex));
    },
    [applySchema, schema]
  );

  const commitSectionReorder = useCallback(
    (dragged: SectionDragId, target: SectionDragId, edge: "above" | "below") => {
      const fromId = dragged.slice("section:".length);
      const toId = target.slice("section:".length);
      const fromIdx = schema.structuredSections.findIndex((s) => s.id === fromId);
      const toIdx = schema.structuredSections.findIndex((s) => s.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      let newIdx = toIdx + (edge === "below" ? 1 : 0);
      if (fromIdx < newIdx) newIdx -= 1;
      applySchema(reorderSections(schema, fromIdx, newIdx));
    },
    [applySchema, schema]
  );

  const autoGroup = useCallback(() => {
    if (
      !window.confirm(
        "Auto-group fields into corner4 / front-rear pairs? Manual row order within sections will be replaced."
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
    setLocalError(null);
  }, [onChange, schema]);

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Drag sections and rows to match how drivers see the sheet. The live preview on the right updates as you edit.
        Removing a row only hides it from the layout — the parameter stays in the{" "}
        <span className="font-medium text-foreground">Parameters</span> tab. Select single rows to
        group manually; edit labels on grouped rows.
      </p>

      {localError ? (
        <div className="rounded border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {localError}
        </div>
      ) : null}

      <div className="space-y-3 min-w-0">
          {!readOnly ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={autoGroup}
              >
                Auto-group fields
              </button>
              {notInLayout.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <select
                    className="rounded border border-border bg-card px-2 py-1 text-xs"
                    value={addFieldKey}
                    onChange={(e) => setAddFieldKey(e.target.value)}
                  >
                    <option value="">Add field to sheet…</option>
                    {notInLayout.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.displayLabel} ({f.key})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-200"
                    disabled={!addFieldKey}
                    onClick={() => {
                      if (!addFieldKey) return;
                      applySchema(addFieldToLayout(schema, addFieldKey));
                      setAddFieldKey("");
                    }}
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3">
            {schema.structuredSections.map((sec) => {
              const sectionDragId: SectionDragId = `section:${sec.id}`;
              const sectionSelected = [...selectedRows]
                .map((id) => parseRowDragId(id))
                .filter((p): p is { sectionId: string; rowIndex: number } => p != null && p.sectionId === sec.id);
              const showSecAbove =
                sectionDropTarget?.id === sectionDragId && sectionDropTarget.edge === "above";
              const showSecBelow =
                sectionDropTarget?.id === sectionDragId && sectionDropTarget.edge === "below";
              return (
                <div key={sec.id} className="relative">
                  {showSecAbove ? (
                    <div className="pointer-events-none absolute -top-1 left-0 right-0 h-0.5 bg-sky-400/80" />
                  ) : null}
                  <div
                    className={`rounded-lg border bg-card/80 p-3 ${
                      draggingSection === sectionDragId ? "opacity-60" : "border-border"
                    }`}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      setDraggingSection(sectionDragId);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDraggingSection(null);
                      setSectionDropTarget(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggingSection || draggingSection === sectionDragId) return;
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const edge: "above" | "below" =
                        e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                      setSectionDropTarget({ id: sectionDragId, edge });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dragged = draggingSection;
                      const edge = sectionDropTarget?.edge ?? "below";
                      setDraggingSection(null);
                      setSectionDropTarget(null);
                      if (dragged && dragged !== sectionDragId) {
                        commitSectionReorder(dragged, sectionDragId, edge);
                      }
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="cursor-grab text-muted-foreground select-none" title="Drag section">
                        ⠿
                      </span>
                      {!readOnly ? (
                        <input
                          className="ui-title flex-1 min-w-0 rounded border border-border bg-card px-2 py-0.5 text-xs"
                          value={sec.title}
                          onChange={(e) =>
                            applySchema(renameSectionTitle(schema, sec.id, e.target.value))
                          }
                        />
                      ) : (
                        <Eyebrow>{sec.title}</Eyebrow>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">{sec.id}</span>
                      {!readOnly && sectionSelected.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px] w-full">
                          <span className="text-muted-foreground">{sectionSelected.length} selected</span>
                          {sectionSelected.length === 2 ? (
                            <button
                              type="button"
                              className="rounded border border-sky-500/50 bg-sky-500/10 px-2 py-0.5 text-sky-200"
                              onClick={() => {
                                const next = groupLayoutRows(
                                  schema,
                                  sec.id,
                                  sectionSelected.map((r) => r.rowIndex),
                                  "pair"
                                );
                                applySchema(next);
                                setSelectedRows(new Set());
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
                                const next = groupLayoutRows(
                                  schema,
                                  sec.id,
                                  sectionSelected.map((r) => r.rowIndex),
                                  "corner4"
                                );
                                applySchema(next);
                                setSelectedRows(new Set());
                              }}
                            >
                              Group as FF / FR / RF / RR
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <ul className="space-y-1">
                      {sec.rows.map((row, rowIdx) => {
                        const rowDragId: RowDragId = `${sec.id}:${rowIdx}`;
                        const layoutGroupId =
                          row.type === "pair" || row.type === "corner4" ? row.layoutGroupId : undefined;
                        const showAbove =
                          rowDropTarget?.id === rowDragId && rowDropTarget.edge === "above";
                        const showBelow =
                          rowDropTarget?.id === rowDragId && rowDropTarget.edge === "below";
                        return (
                          <li key={rowDragId} className="relative">
                            {showAbove ? (
                              <div className="pointer-events-none absolute -top-0.5 left-0 right-0 h-0.5 bg-sky-400/80" />
                            ) : null}
                            <div
                              className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                                draggingRow === rowDragId
                                  ? "border-sky-500/40 bg-sky-500/5 opacity-70"
                                  : "border-border/70 bg-muted/20"
                              }`}
                              draggable={!readOnly}
                              onDragStart={(e) => {
                                setDraggingRow(rowDragId);
                                e.stopPropagation();
                                e.dataTransfer.effectAllowed = "move";
                              }}
                              onDragEnd={() => {
                                setDraggingRow(null);
                                setRowDropTarget(null);
                              }}
                              onDragOver={(e) => {
                                if (!draggingRow || draggingRow === rowDragId) return;
                                const from = parseRowDragId(draggingRow);
                                if (!from || from.sectionId !== sec.id) return;
                                e.preventDefault();
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const edge: "above" | "below" =
                                  e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                                setRowDropTarget({ id: rowDragId, edge });
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                const dragged = draggingRow;
                                const edge = rowDropTarget?.edge ?? "below";
                                setDraggingRow(null);
                                setRowDropTarget(null);
                                if (dragged && dragged !== rowDragId) {
                                  commitRowReorder(dragged, rowDragId, edge);
                                }
                              }}
                            >
                              <span className="cursor-grab text-muted-foreground select-none shrink-0">
                                ⠿
                              </span>
                              {!readOnly && row.type === "single" ? (
                                <input
                                  type="checkbox"
                                  className="shrink-0"
                                  checked={selectedRows.has(rowDragId)}
                                  onChange={(e) => {
                                    setSelectedRows((prev) => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(rowDragId);
                                      else next.delete(rowDragId);
                                      return next;
                                    });
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={`Select ${rowLabel(row)}`}
                                />
                              ) : null}
                              {(row.type === "pair" || row.type === "corner4") && !readOnly ? (
                                <input
                                  className="min-w-0 flex-1 rounded border border-border bg-card px-1.5 py-0.5 text-xs font-medium"
                                  value={row.label}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    if (!layoutGroupId) return;
                                    applySchema(
                                      updateLayoutGroupLabel(schema, layoutGroupId, e.target.value)
                                    );
                                  }}
                                />
                              ) : (
                                <span className="font-medium min-w-0 truncate">{rowLabel(row)}</span>
                              )}
                              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                {row.type}
                              </span>
                              {!readOnly ? (
                                <>
                                  {layoutGroupId ? (
                                    <button
                                      type="button"
                                      className="text-[10px] text-violet-200 hover:underline shrink-0"
                                      onClick={() => applySchema(ungroupLayoutRow(schema, sec.id, rowIdx))}
                                    >
                                      Ungroup
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="ml-auto text-[10px] text-rose-300 hover:underline shrink-0"
                                    onClick={() => applySchema(removeRowFromLayout(schema, sec.id, rowIdx))}
                                  >
                                    Remove
                                  </button>
                                </>
                              ) : null}
                            </div>
                            {showBelow ? (
                              <div className="pointer-events-none absolute -bottom-0.5 left-0 right-0 h-0.5 bg-sky-400/80" />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  {showSecBelow ? (
                    <div className="pointer-events-none absolute -bottom-1 left-0 right-0 h-0.5 bg-sky-400/80" />
                  ) : null}
                </div>
              );
            })}
          </div>
      </div>
    </div>
  );
}
