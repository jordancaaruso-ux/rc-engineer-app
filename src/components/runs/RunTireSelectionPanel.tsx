"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatSessionChain } from "@/lib/tires/tireSetSessionChain";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import { TIRE_MARK_MAX, normalizeTireMark, suggestTireMark } from "@/lib/tires/tireMark";

export type RunTireSetOption = {
  id: string;
  label: string;
  setNumber?: number;
  initialRunCount?: number;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  specificModel?: string | null;
  /** Optional physical mark written on the sidewall (e.g. "7"). */
  mark?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

/** NEW-set choice is pure form state — the set row is created when the run is saved. */
export type NewTireSetIntent = { tireTypeId: string; displayName: string; mark?: string | null };

/** Picker row: a set plus its derived, zero-typing identity (wear, chain, recency, feel). */
type PickerRow = RunTireSetOption & {
  runCount: number;
  chainItems: string[];
  lastUsedAt: string | null;
  lastRating: number | null;
};

type Props = {
  /** Parent catalog — fallback rows until the picker aggregates load. */
  tireSets: RunTireSetOption[];
  tireSetId: string;
  onSelectExistingSet: (setId: string, set: RunTireSetOption | null) => void;
  newSetIntent: NewTireSetIntent | null;
  onNewSetIntentChange: (intent: NewTireSetIntent | null) => void;
  /** Compound to activate in the picker (event spec tire). Never forces a selection. */
  preferredTireType?: { id: string; displayName: string } | null;
  /**
   * When the linked event mandates a controlled/spec tire, the picker is locked
   * to that compound (no `+ Compound`, other compounds hidden) — the driver still
   * picks which set of it they're on. Set at the event; not overridable in a run.
   */
  specTireType?: { id: string; displayName: string } | null;
  runsCompleted: number;
  onRunsCompletedChange: (value: number) => void;
  onRunsCompletedUserTouched: () => void;
  onPrefillClear?: () => void;
  copyTireWarning?: string | null;
  prefillFieldClass?: string;
};

type CompoundGroup = {
  key: string;
  tireTypeId: string | null;
  display: string;
  rows: PickerRow[];
  lastUsedMs: number;
};

function groupKeyForSet(ts: { tireTypeId?: string | null; label: string }): string {
  return ts.tireTypeId ?? `label:${ts.label}`;
}

function toPickerRow(ts: RunTireSetOption): PickerRow {
  return {
    ...ts,
    runCount: ts.initialRunCount ?? 0,
    chainItems: [],
    lastUsedAt: null,
    lastRating: null,
  };
}

function chipClass(selected: boolean) {
  return cn(
    chipToggleClass(selected),
    "px-2.5 py-1.5 text-xs text-left max-w-full truncate"
  );
}

function rowClass(selected: boolean) {
  return cn(
    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition",
    selected ? "bg-accent/15" : "hover:bg-muted"
  );
}

export function RunTireSelectionPanel({
  tireSets,
  tireSetId,
  onSelectExistingSet,
  newSetIntent,
  onNewSetIntentChange,
  preferredTireType,
  specTireType,
  runsCompleted,
  onRunsCompletedChange,
  onRunsCompletedUserTouched,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: Props) {
  const [pickerRows, setPickerRows] = useState<PickerRow[]>([]);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  // The compound the user is currently looking at. A chip tap writes it directly; an external
  // selection change (auto-default, edit hydrate, copy-prefill, event spec) re-syncs it once via
  // the effect below. Single source of truth for the row list — no precedence puzzle.
  const [viewGroupKey, setViewGroupKey] = useState<string | null>(null);
  const [extraCompounds, setExtraCompounds] = useState<Array<{ id: string; displayName: string }>>(
    []
  );
  const [showCompoundPicker, setShowCompoundPicker] = useState(false);
  // Add-a-set sub-flow: age-neutral entry, then fresh-or-used. `createFork` stays null until the
  // driver answers, so a set with history is never pre-labelled "fresh". `markDraft` is the raw
  // sidewall mark being typed; it's pushed (normalized) into the new-set intent as it changes.
  const [createFork, setCreateFork] = useState<"fresh" | "used" | null>(null);
  const [markDraft, setMarkDraft] = useState("");
  const [markNudgeDismissed, setMarkNudgeDismissed] = useState(false);
  // Inline mark editing for a set you already own (the picker doubles as light inventory admin).
  const [markEditingId, setMarkEditingId] = useState<string | null>(null);
  const [markEditValue, setMarkEditValue] = useState("");
  const [markSaving, setMarkSaving] = useState(false);
  const markSavingRef = useRef(false);
  // "write it on the sidewall" reinforcement after naming a set (single row / bulk).
  const [justMarkedId, setJustMarkedId] = useState<string | null>(null);
  const [bulkWriteNums, setBulkWriteNums] = useState<string[] | null>(null);
  const defaultTireSetAppliedRef = useRef(false);
  /** Selection token last mirrored into `viewGroupKey`, so picker refetches don't snap the view. */
  const lastSyncedSelectionRef = useRef<string | null>(null);

  const loadPickerRows = useCallback(async () => {
    try {
      const res = await fetch("/api/tire-sets/picker", { cache: "no-store" });
      const data = (await res.json()) as { tireSets?: PickerRow[] };
      setPickerRows(data.tireSets ?? []);
    } catch {
      setPickerRows([]);
    } finally {
      setPickerLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadPickerRows();
  }, [loadPickerRows]);

  // Event spec tire steers the view toward that compound (chip appears even before any
  // set of it exists); the driver still picks the row.
  useEffect(() => {
    if (!preferredTireType) return;
    setExtraCompounds((prev) =>
      prev.some((c) => c.id === preferredTireType.id)
        ? prev
        : [...prev, { id: preferredTireType.id, displayName: preferredTireType.displayName }]
    );
    setViewGroupKey(preferredTireType.id);
  }, [preferredTireType]);

  // Aggregates are the source of truth once loaded; parent-catalog sets missing from the
  // fetch (race, or fetch failure) still render with their declared prior wear.
  const rows = useMemo(() => {
    const byId = new Map<string, PickerRow>();
    for (const row of pickerRows) byId.set(row.id, row);
    for (const ts of tireSets) {
      if (!byId.has(ts.id)) byId.set(ts.id, toPickerRow(ts));
    }
    return [...byId.values()];
  }, [pickerRows, tireSets]);

  const groups = useMemo(() => {
    const byKey = new Map<string, CompoundGroup>();
    for (const row of rows) {
      const key = groupKeyForSet(row);
      let group = byKey.get(key);
      if (!group) {
        group = {
          key,
          tireTypeId: row.tireTypeId ?? null,
          display: row.tireType?.displayName ?? row.label,
          rows: [],
          lastUsedMs: 0,
        };
        byKey.set(key, group);
      }
      group.rows.push(row);
      const ms = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
      if (ms > group.lastUsedMs) group.lastUsedMs = ms;
    }
    // A compound picked via the combobox that has no sets yet still gets a group (NEW only).
    for (const extra of extraCompounds) {
      if (!byKey.has(extra.id)) {
        byKey.set(extra.id, {
          key: extra.id,
          tireTypeId: extra.id,
          display: extra.displayName,
          rows: [],
          lastUsedMs: 0,
        });
      }
    }
    for (const group of byKey.values()) {
      // Last used first; never-used sets follow (endpoint order = newest created first).
      group.rows.sort((a, b) => {
        const aMs = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const bMs = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        return bMs - aMs;
      });
    }
    return [...byKey.values()].sort((a, b) => b.lastUsedMs - a.lastUsedMs);
  }, [rows, extraCompounds]);

  const selectedRow = useMemo(
    () => (tireSetId ? rows.find((r) => r.id === tireSetId) ?? null : null),
    [rows, tireSetId]
  );

  // The single most-recently-used set across all compounds — it gets the explicit
  // "ran it last" words (and is auto-selected), so recency never masquerades as a badge.
  const mostRecentSetId = useMemo(() => {
    let bestId: string | null = null;
    let bestMs = 0;
    for (const r of rows) {
      const ms = r.lastUsedAt ? new Date(r.lastUsedAt).getTime() : 0;
      if (ms > bestMs) {
        bestMs = ms;
        bestId = r.id;
      }
    }
    return bestId;
  }, [rows]);

  // Leaving the add-a-set flow (selecting an existing set, or clearing) resets the fork and
  // mark draft so the next "Add a set" always starts age-neutral.
  useEffect(() => {
    if (!newSetIntent) {
      setCreateFork(null);
      setMarkDraft("");
    }
  }, [newSetIntent]);

  // A controlled event locks the compound list to the mandated tire (always
  // keeping any already-selected set visible so history is never hidden).
  const specLocked = Boolean(specTireType);
  const visibleGroups = useMemo(() => {
    if (!specTireType) return groups;
    const keep = new Set<string>([specTireType.id]);
    if (selectedRow) keep.add(groupKeyForSet(selectedRow));
    return groups.filter((g) => keep.has(g.key));
  }, [groups, specTireType, selectedRow]);

  // Mirror an *external* selection change into the view: when the selected set or NEW-set intent
  // changes (auto-default, edit hydrate, copy-prefill, event spec), snap the view to its compound
  // — but only once per selection. Keying on a primitive token (not the row object) means a picker
  // refetch, which re-creates row objects with the same ids, never yanks the user off a compound
  // they tapped over to browse while a set from another compound stays selected.
  const selectionToken = tireSetId
    ? `set:${tireSetId}`
    : newSetIntent
      ? `new:${newSetIntent.tireTypeId}`
      : "";
  useEffect(() => {
    if (selectionToken === lastSyncedSelectionRef.current) return;
    if (tireSetId) {
      const row = rows.find((r) => r.id === tireSetId);
      if (!row) return; // selected set not in `rows` yet (aggregates still loading) — wait
      lastSyncedSelectionRef.current = selectionToken;
      setViewGroupKey(groupKeyForSet(row));
    } else if (newSetIntent) {
      lastSyncedSelectionRef.current = selectionToken;
      setViewGroupKey(newSetIntent.tireTypeId);
    } else {
      // Selection cleared with no NEW intent (e.g. event spec about to steer via preferredTireType):
      // mark synced but leave the view where it is.
      lastSyncedSelectionRef.current = selectionToken;
    }
  }, [selectionToken, tireSetId, newSetIntent, rows]);

  // The view is the compound the user is looking at; fall back to most-recently-used.
  const activeGroup = useMemo(() => {
    if (groups.length === 0) return null;
    if (viewGroupKey) {
      const hit = groups.find((g) => g.key === viewGroupKey);
      if (hit) return hit;
    }
    return visibleGroups[0] ?? groups[0];
  }, [groups, visibleGroups, viewGroupKey]);

  function handleSelectRow(row: PickerRow) {
    onSelectExistingSet(row.id, row);
    onPrefillClear?.();
  }

  function handleNewSet(group: CompoundGroup) {
    if (!group.tireTypeId) return;
    beginAddSet(group.tireTypeId, group.display, group.rows);
  }

  // Age-neutral "Add a set": pre-loads the suggested (lowest-free) mark so a set is born named.
  function beginAddSet(tireTypeId: string, display: string, existingRows: PickerRow[]) {
    const suggested = suggestTireMark(existingRows.map((r) => r.mark));
    setCreateFork(null);
    setMarkDraft(suggested);
    onSelectExistingSet("", null);
    onNewSetIntentChange({ tireTypeId, displayName: display, mark: normalizeTireMark(suggested) });
    onPrefillClear?.();
  }

  function handleChipTap(group: CompoundGroup) {
    setViewGroupKey(group.key);
    // Browsing another compound only changes the view — selection changes on a row tap.
    // Except: the current selection belongs elsewhere, so tapping a chip with exactly one
    // obvious choice (no sets → NEW) commits it for fewer taps.
    if (group.rows.length === 0 && group.tireTypeId) {
      handleNewSet(group);
    }
  }

  function handleCompoundPicked(id: string, option: { id: string; displayName: string } | null) {
    if (!id) return;
    if (option) {
      setExtraCompounds((prev) =>
        prev.some((c) => c.id === option.id) ? prev : [...prev, { id: option.id, displayName: option.displayName }]
      );
    }
    setViewGroupKey(id);
    setShowCompoundPicker(false);
    const existing = groups.find((g) => g.key === id);
    if (!existing || existing.rows.length === 0) {
      const display = option?.displayName ?? existing?.display ?? "";
      if (display) {
        beginAddSet(id, display, existing?.rows ?? []);
      }
    }
  }

  // Default the field to the most recently used set — the common case is "same tires as
  // last run", which should cost zero taps.
  useEffect(() => {
    if (
      defaultTireSetAppliedRef.current ||
      !pickerLoaded ||
      tireSetId ||
      newSetIntent ||
      groups.length === 0
    ) {
      return;
    }
    const first = groups[0]?.rows[0];
    if (!first || !first.lastUsedAt) return; // nothing ever used — don't guess
    defaultTireSetAppliedRef.current = true;
    handleSelectRow(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerLoaded, tireSetId, newSetIntent, groups]);

  const newSelected = Boolean(
    !tireSetId && newSetIntent && activeGroup && newSetIntent.tireTypeId === activeGroup.key
  );
  const hasSelection = Boolean(tireSetId || newSetIntent);

  function nudge(delta: number, min = 0) {
    onRunsCompletedUserTouched();
    onRunsCompletedChange(Math.max(min, runsCompleted + delta));
  }

  // Fresh = brand-new rubber = always run 1, no counter. Used = has history, reveal the count.
  function chooseFresh() {
    setCreateFork("fresh");
    onRunsCompletedUserTouched();
    onRunsCompletedChange(0);
  }
  function chooseUsed() {
    setCreateFork("used");
    onRunsCompletedUserTouched();
    onRunsCompletedChange(Math.max(1, runsCompleted));
  }
  function handleMarkChange(raw: string) {
    setMarkDraft(raw);
    // Same compound → NewRunForm preserves runsCompleted; only the mark updates on the intent.
    if (newSetIntent) {
      onNewSetIntentChange({ ...newSetIntent, mark: normalizeTireMark(raw) });
    }
  }

  const activeUnmarked = activeGroup
    ? activeGroup.rows.filter((r) => !normalizeTireMark(r.mark))
    : [];
  const showMarkNudge = !specLocked && !markNudgeDismissed && activeUnmarked.length >= 2;

  // Lowest-free number suggested for each unmarked set of the active compound (ascending, recycled).
  const suggestedByRow = useMemo(() => {
    const map = new Map<string, string>();
    if (!activeGroup) return map;
    const taken = new Set<number>();
    for (const r of activeGroup.rows) {
      const m = normalizeTireMark(r.mark);
      if (m && /^\d+$/.test(m)) taken.add(parseInt(m, 10));
    }
    let n = 1;
    for (const r of activeGroup.rows) {
      if (normalizeTireMark(r.mark)) continue;
      while (taken.has(n)) n++;
      map.set(r.id, String(n));
      taken.add(n);
    }
    return map;
  }, [activeGroup]);

  function startMarkEdit(row: PickerRow) {
    setMarkEditingId(row.id);
    setMarkEditValue(normalizeTireMark(row.mark) ?? "");
  }
  function cancelMarkEdit() {
    setMarkEditingId(null);
    setMarkEditValue("");
  }
  async function commitMark(rowId: string, mark: string | null) {
    await fetch(`/api/tire-sets/${encodeURIComponent(rowId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark }),
    });
  }
  // One tap: accept the suggested number for an unnamed set.
  async function markOne(row: PickerRow, mark: string) {
    if (markSavingRef.current) return;
    markSavingRef.current = true;
    setMarkSaving(true);
    setBulkWriteNums(null);
    try {
      await commitMark(row.id, mark);
      await loadPickerRows();
      setJustMarkedId(row.id);
    } catch {
      // leave as-is; retryable
    } finally {
      markSavingRef.current = false;
      setMarkSaving(false);
    }
  }
  // Name every unnamed set of the compound at once.
  async function markAll() {
    if (markSavingRef.current || !activeGroup) return;
    const targets = activeGroup.rows
      .filter((r) => !normalizeTireMark(r.mark) && suggestedByRow.get(r.id))
      .map((r) => ({ id: r.id, mark: suggestedByRow.get(r.id) as string }));
    if (targets.length === 0) return;
    markSavingRef.current = true;
    setMarkSaving(true);
    setJustMarkedId(null);
    try {
      for (const t of targets) await commitMark(t.id, t.mark);
      setBulkWriteNums(targets.map((t) => t.mark));
    } catch {
      // partial success is fine — the refetch shows what stuck
    } finally {
      await loadPickerRows();
      markSavingRef.current = false;
      setMarkSaving(false);
    }
  }
  async function saveMarkEdit(rowId: string) {
    if (markSavingRef.current) return; // dedupe Enter-then-blur double fire
    markSavingRef.current = true;
    const mark = normalizeTireMark(markEditValue);
    setMarkSaving(true);
    try {
      await commitMark(rowId, mark);
      await loadPickerRows();
      if (mark) setJustMarkedId(rowId);
    } catch {
      // Leave the row as-is on failure; the driver can retry.
    } finally {
      markSavingRef.current = false;
      setMarkSaving(false);
      cancelMarkEdit();
    }
  }

  return (
    <div className="space-y-3 text-sm">
      {specTireType ? (
        <div className="rounded-md border border-border bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
          Controlled tire ·{" "}
          <span className="font-medium text-foreground">{specTireType.displayName}</span>{" "}
          — pick which set you&apos;re on.
        </div>
      ) : null}

      <div className={cn("space-y-2", prefillFieldClass)}>
        <div className="flex items-end justify-between gap-3">
          <Eyebrow dot="muted">Tire set</Eyebrow>
          {!specLocked ? (
            <button
              type="button"
              className="btn-surface px-3 py-1.5 text-xs shrink-0"
              onClick={() => setShowCompoundPicker((v) => !v)}
            >
              {showCompoundPicker ? "Cancel" : "+ Compound"}
            </button>
          ) : null}
        </div>

        {visibleGroups.length > 0 && !specLocked ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tire compounds">
            {visibleGroups.map((g) => (
              <button
                key={g.key}
                type="button"
                className={chipClass(g.key === activeGroup?.key)}
                onClick={() => handleChipTap(g)}
              >
                {g.display}
              </button>
            ))}
          </div>
        ) : null}

        {showCompoundPicker && !specLocked ? (
          <div className="space-y-1">
            <div className="type-data-label">Tire type</div>
            <TireTypeCombobox
              value=""
              onChange={() => {}}
              onSelectedTypeChange={(option) => {
                if (option) handleCompoundPicked(option.id, option);
              }}
              placeholder="Select tire type…"
              aria-label="Tire type"
            />
          </div>
        ) : null}

        {!pickerLoaded && rows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Loading your sets…</p>
        ) : null}

        {pickerLoaded && groups.length === 0 ? (
          <p className="text-[11px] text-muted-foreground leading-snug">
            No tire sets yet. Tap <span className="font-medium text-foreground">+ Compound</span> to
            pick what you&apos;re running, then tell us if the set is fresh or already has runs.
          </p>
        ) : null}

        {activeGroup ? (
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
            {activeGroup.rows.map((row) => {
              const selected = row.id === tireSetId;
              const chain = formatSessionChain(row.chainItems);
              const mark = normalizeTireMark(row.mark);
              const runLabel = `${row.runCount} ${row.runCount === 1 ? "run" : "runs"}`;
              const isMostRecent = row.id === mostRecentSetId && Boolean(row.lastUsedAt);
              const editing = markEditingId === row.id;
              const suggested = suggestedByRow.get(row.id);
              const justWritten = justMarkedId === row.id && Boolean(mark);
              const wear = `${runLabel}${chain ? ` · ${chain}` : row.lastUsedAt ? "" : " · not used yet"}`;
              return (
                <div key={row.id} className={cn(rowClass(selected), "cursor-default")}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    aria-pressed={selected}
                    onClick={() => handleSelectRow(row)}
                  >
                    {mark ? (
                      <span className="inline-flex w-11 shrink-0 flex-col items-center rounded-md border border-border px-1 py-0.5 leading-none">
                        <span className="font-mono text-sm font-semibold text-foreground">{mark}</span>
                        <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wide text-muted-foreground">
                          mark
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex w-11 shrink-0 items-center justify-center rounded-md border border-dashed border-border py-1.5 font-mono text-base font-light text-muted-foreground">
                        ?
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[13px]",
                          mark ? "font-medium text-foreground" : "font-medium text-muted-foreground"
                        )}
                      >
                        {mark ? `Marked ${mark}` : "Unnamed set"}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{wear}</span>
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2 pl-1">
                    {mark && row.lastRating != null ? (
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {row.lastRating}/10
                      </span>
                    ) : null}
                    {isMostRecent ? (
                      <span className="font-mono text-[10px] text-muted-foreground">ran it last</span>
                    ) : mark && row.lastUsedAt ? (
                      <RelativeTime iso={row.lastUsedAt} fallback="" className="text-[10px]" />
                    ) : null}
                    {editing ? (
                      <input
                        autoFocus
                        value={markEditValue}
                        maxLength={TIRE_MARK_MAX}
                        disabled={markSaving}
                        placeholder="—"
                        aria-label="Mark for this set"
                        className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center font-mono text-xs text-foreground"
                        onChange={(e) => setMarkEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void saveMarkEdit(row.id);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            cancelMarkEdit();
                          }
                        }}
                        onBlur={() => void saveMarkEdit(row.id)}
                      />
                    ) : justWritten ? (
                      <span className="font-mono text-[10px] text-primary">✎ write {mark} on it</span>
                    ) : mark ? (
                      <button
                        type="button"
                        className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        aria-label="Edit mark"
                        onClick={() => startMarkEdit(row)}
                      >
                        edit
                      </button>
                    ) : (
                      <>
                        {suggested ? (
                          <button
                            type="button"
                            className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                            aria-label={`Mark this set ${suggested}`}
                            disabled={markSaving}
                            onClick={() => markOne(row, suggested)}
                          >
                            Mark {suggested}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rounded px-1 py-0.5 text-[11px] leading-none text-muted-foreground hover:text-foreground"
                          aria-label="Type a custom mark"
                          onClick={() => startMarkEdit(row)}
                        >
                          ✎
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
            {activeGroup.tireTypeId ? (
              <button
                type="button"
                className={rowClass(newSelected)}
                aria-pressed={newSelected}
                onClick={() => handleNewSet(activeGroup)}
              >
                <span className="w-16 shrink-0 text-center font-mono text-lg font-light text-muted-foreground">
                  +
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-[13px] font-medium text-foreground">Add a set</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    new tires — or one that already has runs
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {bulkWriteNums && bulkWriteNums.length > 0 ? (
          <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
            Named <span className="font-medium text-primary">{bulkWriteNums.join(", ")}</span>. Grab a
            paint pen and write each number on its set — then they&apos;re never mixed up again.
          </div>
        ) : showMarkNudge ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex-1 leading-snug">
              {activeUnmarked.length} {activeGroup?.display} sets look alike — name them so they never
              get mixed up.
            </span>
            <button
              type="button"
              className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              disabled={markSaving}
              onClick={markAll}
            >
              Mark all {activeUnmarked.length}
            </button>
            <button
              type="button"
              className="shrink-0 leading-none text-muted-foreground hover:text-foreground"
              aria-label="Dismiss"
              onClick={() => setMarkNudgeDismissed(true)}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      {copyTireWarning ? <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div> : null}

      {newSelected ? (
        <div className="space-y-2.5 rounded-xl border border-border bg-secondary/40 px-3 py-3">
          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">
              Fresh tires, or does this set already have runs?
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Set condition">
              <button
                type="button"
                aria-pressed={createFork === "fresh"}
                className={chipClass(createFork === "fresh")}
                onClick={chooseFresh}
              >
                Fresh · new rubber
              </button>
              <button
                type="button"
                aria-pressed={createFork === "used"}
                className={chipClass(createFork === "used")}
                onClick={chooseUsed}
              >
                Used · has runs
              </button>
            </div>
          </div>

          {createFork === "used" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground">Runs it&apos;s already done</span>
              <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Prior run count">
                <button
                  type="button"
                  className="btn-surface h-7 w-7 font-mono text-sm leading-none"
                  aria-label="One fewer prior run"
                  disabled={runsCompleted <= 1}
                  onClick={() => nudge(-1, 1)}
                >
                  −
                </button>
                <span className="w-6 text-center font-mono text-sm tabular-nums text-foreground">
                  {runsCompleted}
                </span>
                <button
                  type="button"
                  className="btn-surface h-7 w-7 font-mono text-sm leading-none"
                  aria-label="One more prior run"
                  onClick={() => nudge(1, 1)}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <label htmlFor="tire-mark" className="text-[11px] text-muted-foreground">
              Mark
            </label>
            <input
              id="tire-mark"
              value={markDraft}
              maxLength={TIRE_MARK_MAX}
              onChange={(e) => handleMarkChange(e.target.value)}
              placeholder="—"
              aria-label="Mark written on the tire"
              className="w-16 rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground"
            />
            <span className="text-[10px] text-muted-foreground">write it on the sidewall too</span>
          </div>

          <div className="text-[11px] text-muted-foreground leading-snug">
            {createFork === null ? (
              "Choose fresh or used to continue."
            ) : createFork === "fresh" ? (
              <>
                This log is <span className="font-medium text-foreground">run #1</span> on a fresh set
                {markDraft.trim() ? ` · Marked ${markDraft.trim()}` : ""}.
              </>
            ) : (
              <>
                This log is{" "}
                <span className="font-medium text-foreground">run #{runsCompleted + 1}</span> on a used
                set — {runsCompleted} prior run{runsCompleted === 1 ? "" : "s"}
                {markDraft.trim() ? ` · Marked ${markDraft.trim()}` : ""}.
              </>
            )}
          </div>
        </div>
      ) : hasSelection ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground leading-snug">
            This log is{" "}
            <span className="font-medium text-foreground">run #{runsCompleted + 1}</span> on these
            {runsCompleted === 0 ? " — first run on them" : ""}.
          </div>
          <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Adjust prior run count">
            <button
              type="button"
              className="btn-surface h-7 w-7 font-mono text-sm leading-none"
              aria-label="One fewer prior run"
              disabled={runsCompleted <= 0}
              onClick={() => nudge(-1)}
            >
              −
            </button>
            <button
              type="button"
              className="btn-surface h-7 w-7 font-mono text-sm leading-none"
              aria-label="One more prior run"
              onClick={() => nudge(1)}
            >
              +
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
