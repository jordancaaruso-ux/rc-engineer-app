"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ImageCalibrationField,
  ImageRegion,
} from "@/lib/setupCalibrations/types";
import type { SetupFieldMeta } from "@/lib/setupFieldCatalog";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";

type FieldKind = "text" | "checkbox" | "singleChoiceGroup" | "multiSelectGroup";

type DraftOption = { id: string; value: string; region: ImageRegion };

type DraftField = {
  id: string;
  key: string;
  kind: FieldKind;
  region?: ImageRegion;
  numericOnly?: boolean;
  checkedValue?: string;
  uncheckedValue?: string;
  options: DraftOption[];
};

type DraftAnchor = { id: string; region: ImageRegion };

type DraftMode =
  | { kind: "field-region"; fieldId: string }
  | { kind: "field-option"; fieldId: string; optionId: string }
  | { kind: "anchor"; anchorId?: string };

type Props = {
  documentId: string;
  documentFilename: string;
  imageUrl: string;
  fieldCatalog: SetupFieldMeta[];
  initialFields?: ImageCalibrationField[];
  initialAnchors?: ImageRegion[];
  initialName?: string;
  initialCalibrationId?: string;
};

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}`;
}

function defaultKindForKey(key: string): FieldKind {
  const k = getCalibrationFieldKind(key);
  if (k === "boolean") return "checkbox";
  if (k === "singleSelect" || k === "paired") return "singleChoiceGroup";
  if (k === "visualMulti") return "multiSelectGroup";
  return "text";
}

function fieldFromInitial(field: ImageCalibrationField): DraftField {
  if (field.kind === "text") {
    return {
      id: newId("f"),
      key: field.key,
      kind: "text",
      region: field.region,
      numericOnly: field.numericOnly,
      options: [],
    };
  }
  if (field.kind === "checkbox") {
    return {
      id: newId("f"),
      key: field.key,
      kind: "checkbox",
      region: field.region,
      checkedValue: field.checkedValue,
      uncheckedValue: field.uncheckedValue,
      options: [],
    };
  }
  return {
    id: newId("f"),
    key: field.key,
    kind: field.kind,
    options: field.options.map((o) => ({ id: newId("o"), value: o.value, region: o.region })),
  };
}

function regionsEqual(a: ImageRegion | undefined, b: ImageRegion): boolean {
  if (!a) return false;
  return a.xPct === b.xPct && a.yPct === b.yPct && a.wPct === b.wPct && a.hPct === b.hPct;
}

export function ImageCalibrationEditorClient(props: Props) {
  const router = useRouter();
  const [name, setName] = useState(props.initialName ?? `Image calibration · ${props.documentFilename}`);
  const [fields, setFields] = useState<DraftField[]>(
    (props.initialFields ?? []).map(fieldFromInitial)
  );
  const [anchors, setAnchors] = useState<DraftAnchor[]>(
    (props.initialAnchors ?? []).map((r) => ({ id: newId("a"), region: r }))
  );
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [drawMode, setDrawMode] = useState<DraftMode | null>(null);
  const [dragStart, setDragStart] = useState<{ xPct: number; yPct: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ xPct: number; yPct: number } | null>(null);
  const [keyFilter, setKeyFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState<{ calibrationId: string } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const groupedCatalog = useMemo(() => {
    const filter = keyFilter.trim().toLowerCase();
    const out = new Map<string, SetupFieldMeta[]>();
    for (const meta of props.fieldCatalog) {
      if (
        filter
        && !meta.label.toLowerCase().includes(filter)
        && !meta.key.toLowerCase().includes(filter)
      ) {
        continue;
      }
      const list = out.get(meta.groupTitle) ?? [];
      list.push(meta);
      out.set(meta.groupTitle, list);
    }
    return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [keyFilter, props.fieldCatalog]);

  const usedKeys = useMemo(() => new Set(fields.map((f) => f.key).filter(Boolean)), [fields]);

  const inProgressRect = useMemo<ImageRegion | null>(() => {
    if (!dragStart || !dragCurrent) return null;
    return {
      xPct: Math.min(dragStart.xPct, dragCurrent.xPct),
      yPct: Math.min(dragStart.yPct, dragCurrent.yPct),
      wPct: Math.abs(dragCurrent.xPct - dragStart.xPct),
      hPct: Math.abs(dragCurrent.yPct - dragStart.yPct),
    };
  }, [dragStart, dragCurrent]);

  const addField = useCallback((key: string) => {
    const id = newId("f");
    setFields((prev) => [
      ...prev,
      { id, key, kind: defaultKindForKey(key), options: [] },
    ]);
    setActiveFieldId(id);
    setDrawMode({ kind: "field-region", fieldId: id });
  }, []);

  const updateField = useCallback((id: string, patch: Partial<DraftField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    setActiveFieldId((prev) => (prev === id ? null : prev));
    setDrawMode((prev) => (prev && "fieldId" in prev && prev.fieldId === id ? null : prev));
  }, []);

  const addOption = useCallback((fieldId: string) => {
    const optId = newId("o");
    setFields((prev) =>
      prev.map((f) =>
        f.id === fieldId
          ? { ...f, options: [...f.options, { id: optId, value: "", region: { xPct: 0, yPct: 0, wPct: 0, hPct: 0 } }] }
          : f
      )
    );
    setDrawMode({ kind: "field-option", fieldId, optionId: optId });
  }, []);

  const updateOption = useCallback(
    (fieldId: string, optionId: string, patch: Partial<DraftOption>) => {
      setFields((prev) =>
        prev.map((f) => {
          if (f.id !== fieldId) return f;
          return {
            ...f,
            options: f.options.map((o) => (o.id === optionId ? { ...o, ...patch } : o)),
          };
        })
      );
    },
    []
  );

  const removeOption = useCallback((fieldId: string, optionId: string) => {
    setFields((prev) =>
      prev.map((f) => {
        if (f.id !== fieldId) return f;
        return { ...f, options: f.options.filter((o) => o.id !== optionId) };
      })
    );
  }, []);

  const addAnchor = useCallback(() => {
    const id = newId("a");
    setAnchors((prev) => [...prev, { id, region: { xPct: 0, yPct: 0, wPct: 0, hPct: 0 } }]);
    setDrawMode({ kind: "anchor", anchorId: id });
  }, []);

  const removeAnchor = useCallback((id: string) => {
    setAnchors((prev) => prev.filter((a) => a.id !== id));
  }, []);

  function pointFromEvent(ev: React.MouseEvent): { xPct: number; yPct: number } | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const xPct = (ev.clientX - rect.left) / rect.width;
    const yPct = (ev.clientY - rect.top) / rect.height;
    if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) return null;
    return {
      xPct: Math.max(0, Math.min(1, xPct)),
      yPct: Math.max(0, Math.min(1, yPct)),
    };
  }

  function onOverlayPointerDown(ev: React.MouseEvent) {
    if (!drawMode) return;
    const p = pointFromEvent(ev);
    if (!p) return;
    setDragStart(p);
    setDragCurrent(p);
  }
  function onOverlayPointerMove(ev: React.MouseEvent) {
    if (!drawMode || !dragStart) return;
    const p = pointFromEvent(ev);
    if (!p) return;
    setDragCurrent(p);
  }
  function onOverlayPointerUp(ev: React.MouseEvent) {
    if (!drawMode || !dragStart) return;
    const p = pointFromEvent(ev);
    if (!p) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    const region: ImageRegion = {
      xPct: Math.min(dragStart.xPct, p.xPct),
      yPct: Math.min(dragStart.yPct, p.yPct),
      wPct: Math.abs(p.xPct - dragStart.xPct),
      hPct: Math.abs(p.yPct - dragStart.yPct),
    };
    if (region.wPct < 0.01 || region.hPct < 0.01) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }
    if (drawMode.kind === "field-region") {
      updateField(drawMode.fieldId, { region });
    } else if (drawMode.kind === "field-option") {
      updateOption(drawMode.fieldId, drawMode.optionId, { region });
    } else if (drawMode.kind === "anchor") {
      const id = drawMode.anchorId;
      if (id) {
        setAnchors((prev) => prev.map((a) => (a.id === id ? { ...a, region } : a)));
      }
    }
    setDragStart(null);
    setDragCurrent(null);
    setDrawMode(null);
  }

  const collectFieldsForSave = useCallback((): { ok: true; fields: ImageCalibrationField[] } | { ok: false; error: string } => {
    const out: ImageCalibrationField[] = [];
    for (const f of fields) {
      if (!f.key) return { ok: false, error: "Every field needs a key." };
      if (f.kind === "text") {
        if (!f.region) return { ok: false, error: `Field "${f.key}" needs a region.` };
        out.push({ kind: "text", key: f.key, region: f.region, numericOnly: f.numericOnly || undefined });
      } else if (f.kind === "checkbox") {
        if (!f.region) return { ok: false, error: `Field "${f.key}" needs a region.` };
        out.push({
          kind: "checkbox",
          key: f.key,
          region: f.region,
          checkedValue: f.checkedValue ?? "1",
          uncheckedValue: f.uncheckedValue ?? "",
        });
      } else {
        const opts: Array<{ value: string; region: ImageRegion }> = [];
        for (const o of f.options) {
          if (!o.value.trim()) {
            return { ok: false, error: `Field "${f.key}" has an unnamed option.` };
          }
          if (o.region.wPct === 0 || o.region.hPct === 0) {
            return { ok: false, error: `Field "${f.key}" option "${o.value}" needs a region.` };
          }
          opts.push({ value: o.value.trim(), region: o.region });
        }
        if (opts.length < 2) return { ok: false, error: `Field "${f.key}" needs at least two options.` };
        out.push({ kind: f.kind, key: f.key, options: opts });
      }
    }
    return { ok: true, fields: out };
  }, [fields]);

  const onSave = useCallback(async () => {
    setSaveError(null);
    const collected = collectFieldsForSave();
    if (!collected.ok) {
      setSaveError(collected.error);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/setup-calibrations/image-from-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calibrationId: props.initialCalibrationId ?? null,
          name,
          exampleDocumentId: props.documentId,
          fields: collected.fields,
          anchors: anchors
            .filter((a) => a.region.wPct > 0 && a.region.hPct > 0)
            .map((a) => a.region),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { calibrationId?: string; error?: string };
      if (!res.ok || !data.calibrationId) {
        setSaveError(data.error?.trim() || `Save failed (${res.status})`);
        return;
      }
      setSaveOk({ calibrationId: data.calibrationId });
      try {
        await fetch(`/api/setup-documents/${props.documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calibrationProfileId: data.calibrationId }),
        });
        await fetch(`/api/setup-documents/${props.documentId}/process`, { method: "POST" });
      } catch {
        // Non-fatal; review screen will offer a manual re-process button.
      }
      router.push(`/setup-documents/${props.documentId}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  }, [anchors, collectFieldsForSave, name, props.documentId, props.initialCalibrationId, router]);

  const activeField = fields.find((f) => f.id === activeFieldId) ?? null;
  const activeOptionId = drawMode?.kind === "field-option" ? drawMode.optionId : null;

  // Style helpers
  const overlayCursor = drawMode ? "crosshair" : "default";

  // Render rectangle overlays
  function renderRect(region: ImageRegion, color: string, label?: string, key?: string) {
    return (
      <div
        key={key}
        className="absolute pointer-events-none"
        style={{
          left: `${region.xPct * 100}%`,
          top: `${region.yPct * 100}%`,
          width: `${region.wPct * 100}%`,
          height: `${region.hPct * 100}%`,
          border: `2px solid ${color}`,
          background: `${color}22`,
        }}
      >
        {label ? (
          <div
            className="absolute -top-5 left-0 text-[10px] font-medium px-1 rounded"
            style={{ background: color, color: "white" }}
          >
            {label}
          </div>
        ) : null}
      </div>
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDragStart(null);
        setDragCurrent(null);
        setDrawMode(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
      <section className="space-y-3">
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <div className="relative" style={{ cursor: overlayCursor }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={props.imageUrl}
              alt={props.documentFilename}
              className="block w-full h-auto select-none"
              draggable={false}
            />
            <div
              ref={overlayRef}
              className="absolute inset-0"
              onMouseDown={onOverlayPointerDown}
              onMouseMove={onOverlayPointerMove}
              onMouseUp={onOverlayPointerUp}
              onMouseLeave={() => {
                setDragStart(null);
                setDragCurrent(null);
              }}
            >
              {fields.map((f) => {
                const color = f.id === activeFieldId ? "#22c55e" : "#3b82f6";
                const label = f.key || "(no key)";
                return (
                  <div key={f.id}>
                    {f.region ? renderRect(f.region, color, label, `${f.id}-r`) : null}
                    {f.options.map((o) =>
                      o.region.wPct > 0 && o.region.hPct > 0
                        ? renderRect(
                            o.region,
                            o.id === activeOptionId ? "#16a34a" : "#0ea5e9",
                            `${f.key}=${o.value || "?"}`,
                            `${o.id}-r`
                          )
                        : null
                    )}
                  </div>
                );
              })}
              {anchors.map((a) =>
                a.region.wPct > 0 && a.region.hPct > 0
                  ? renderRect(a.region, "#a855f7", "anchor", `${a.id}-r`)
                  : null
              )}
              {inProgressRect ? renderRect(inProgressRect, "#f97316", "drawing") : null}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Click &ldquo;Draw&rdquo; on a field, then drag a rectangle on the screenshot. Use Escape to cancel a draw.
          Anchors are small visual landmarks (logos, headers) the app uses to verify alignment of
          future uploads.
        </p>
      </section>

      <aside className="space-y-3">
        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="text-sm font-medium">Calibration</div>
          <label className="block text-xs text-muted-foreground">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="Friendly name (e.g. A800RR Hudy 2024 sheet)"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save calibration & re-import"}
          </button>
          {saveError ? (
            <div className="rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
              {saveError}
            </div>
          ) : null}
          {saveOk ? (
            <div className="rounded border border-emerald-500/50 bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
              Saved. Returning to document review…
            </div>
          ) : null}
        </div>

        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Anchors ({anchors.length})</div>
            <button
              type="button"
              onClick={addAnchor}
              className="text-xs rounded border border-border px-2 py-1 hover:bg-muted"
            >
              + Add anchor
            </button>
          </div>
          {anchors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Optional. Mark 1–3 stable visual landmarks (header logo, fixed text) so the app can
              detect alignment drift on future uploads.
            </p>
          ) : (
            <ul className="space-y-1">
              {anchors.map((a, i) => (
                <li key={a.id} className="flex items-center justify-between text-xs">
                  <span>
                    Anchor {i + 1}{" "}
                    {a.region.wPct > 0 ? (
                      <span className="text-muted-foreground">
                        ({(a.region.xPct * 100).toFixed(1)}%, {(a.region.yPct * 100).toFixed(1)}%)
                      </span>
                    ) : (
                      <span className="text-amber-600">(needs region)</span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setDrawMode({ kind: "anchor", anchorId: a.id })}
                      className="rounded border border-border px-2 py-0.5 hover:bg-muted"
                    >
                      Draw
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAnchor(a.id)}
                      className="rounded border border-border px-2 py-0.5 hover:bg-muted text-destructive"
                    >
                      Delete
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="text-sm font-medium">Add field</div>
          <input
            value={keyFilter}
            onChange={(e) => setKeyFilter(e.target.value)}
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
            placeholder="Filter setup fields…"
          />
          <div className="max-h-64 overflow-auto pr-1 -mr-1 space-y-2">
            {groupedCatalog.map(([groupTitle, items]) => (
              <div key={groupTitle}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  {groupTitle}
                </div>
                <div className="grid grid-cols-1 gap-0.5">
                  {items.map((meta) => {
                    const used = usedKeys.has(meta.key);
                    return (
                      <button
                        key={meta.key}
                        type="button"
                        onClick={() => addField(meta.key)}
                        disabled={used}
                        className="flex items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <span className="truncate">{meta.label}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">{meta.key}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {groupedCatalog.length === 0 ? (
              <p className="text-xs text-muted-foreground">No matching fields.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-md border border-border bg-card p-3 space-y-2">
          <div className="text-sm font-medium">Mapped fields ({fields.length})</div>
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No fields yet. Pick a setup field above, then drag a rectangle around its value on the
              screenshot.
            </p>
          ) : (
            <ul className="space-y-2">
              {fields.map((f) => (
                <li
                  key={f.id}
                  className={`rounded border p-2 ${f.id === activeFieldId ? "border-primary" : "border-border"}`}
                  onClick={() => setActiveFieldId(f.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium truncate">{f.key}</div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeField(f.id);
                      }}
                      className="text-[10px] text-destructive hover:underline"
                    >
                      remove
                    </button>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[10px]">
                    <label className="flex items-center gap-1">
                      <span className="text-muted-foreground">Kind</span>
                      <select
                        value={f.kind}
                        onChange={(e) =>
                          updateField(f.id, {
                            kind: e.target.value as FieldKind,
                            options: e.target.value.endsWith("Group") ? f.options : [],
                            region: e.target.value.endsWith("Group") ? undefined : f.region,
                          })
                        }
                        className="flex-1 rounded border border-border bg-background px-1 py-0.5"
                      >
                        <option value="text">text</option>
                        <option value="checkbox">checkbox</option>
                        <option value="singleChoiceGroup">single-choice group</option>
                        <option value="multiSelectGroup">multi-select group</option>
                      </select>
                    </label>
                    {f.kind === "text" ? (
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={Boolean(f.numericOnly)}
                          onChange={(e) => updateField(f.id, { numericOnly: e.target.checked })}
                        />
                        <span className="text-muted-foreground">Numeric only</span>
                      </label>
                    ) : null}
                  </div>
                  {(f.kind === "text" || f.kind === "checkbox") ? (
                    <div className="mt-1 flex items-center gap-2 text-[10px]">
                      <span className="text-muted-foreground flex-1">
                        {f.region
                          ? `${(f.region.wPct * 100).toFixed(1)}% × ${(f.region.hPct * 100).toFixed(1)}%`
                          : "no region"}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFieldId(f.id);
                          setDrawMode({ kind: "field-region", fieldId: f.id });
                        }}
                        className="rounded border border-border px-2 py-0.5 hover:bg-muted"
                      >
                        Draw
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 space-y-1">
                      {f.options.map((o) => (
                        <div key={o.id} className="flex items-center gap-1 text-[10px]">
                          <input
                            value={o.value}
                            onChange={(e) =>
                              updateOption(f.id, o.id, { value: e.target.value })
                            }
                            placeholder="value"
                            className="w-20 rounded border border-border bg-background px-1 py-0.5"
                          />
                          <span className="text-muted-foreground flex-1 truncate">
                            {o.region.wPct > 0
                              ? `${(o.region.wPct * 100).toFixed(1)}% × ${(o.region.hPct * 100).toFixed(1)}%`
                              : "no region"}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveFieldId(f.id);
                              setDrawMode({ kind: "field-option", fieldId: f.id, optionId: o.id });
                            }}
                            className="rounded border border-border px-1.5 py-0.5 hover:bg-muted"
                          >
                            Draw
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeOption(f.id, o.id);
                            }}
                            className="rounded border border-border px-1.5 py-0.5 hover:bg-muted text-destructive"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addOption(f.id);
                        }}
                        className="text-[10px] rounded border border-border px-2 py-0.5 hover:bg-muted"
                      >
                        + option
                      </button>
                    </div>
                  )}
                  {activeField?.id === f.id && drawMode ? (
                    <div className="mt-1 text-[10px] text-primary">
                      Drawing — drag on the image, or press Escape to cancel.
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

export type { Props as ImageCalibrationEditorClientProps };
export type { ImageCalibrationField, ImageRegion };
