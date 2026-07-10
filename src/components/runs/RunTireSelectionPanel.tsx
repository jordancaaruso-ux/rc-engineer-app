"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { formatSessionChain } from "@/lib/tires/tireSetSessionChain";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";

export type RunTireSetOption = {
  id: string;
  label: string;
  setNumber?: number;
  initialRunCount?: number;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  specificModel?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

/** NEW-set choice is pure form state — the set row is created when the run is saved. */
export type NewTireSetIntent = { tireTypeId: string; displayName: string };

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
    return groups[0];
  }, [groups, viewGroupKey]);

  function handleSelectRow(row: PickerRow) {
    onSelectExistingSet(row.id, row);
    onPrefillClear?.();
  }

  function handleNewSet(group: CompoundGroup) {
    if (!group.tireTypeId) return;
    onSelectExistingSet("", null);
    onNewSetIntentChange({ tireTypeId: group.tireTypeId, displayName: group.display });
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
        onSelectExistingSet("", null);
        onNewSetIntentChange({ tireTypeId: id, displayName: display });
        onPrefillClear?.();
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

  function nudge(delta: number) {
    onRunsCompletedUserTouched();
    onRunsCompletedChange(Math.max(0, runsCompleted + delta));
  }

  return (
    <div className="space-y-3 text-sm">
      <div className={cn("space-y-2", prefillFieldClass)}>
        <div className="flex items-end justify-between gap-3">
          <Eyebrow dot="muted">Tire set</Eyebrow>
          <button
            type="button"
            className="btn-surface px-3 py-1.5 text-xs shrink-0"
            onClick={() => setShowCompoundPicker((v) => !v)}
          >
            {showCompoundPicker ? "Cancel" : "+ Compound"}
          </button>
        </div>

        {groups.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tire compounds">
            {groups.map((g) => (
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

        {showCompoundPicker ? (
          <div className="space-y-1">
            <div className="type-data-label">Tire type</div>
            <TireTypeCombobox
              value=""
              onChange={() => {}}
              onSelectedTypeChange={(option) => {
                if (option) handleCompoundPicked(option.id, option);
              }}
              placeholder="Search or add tire type"
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
            pick what you&apos;re running — your first set starts on this log.
          </p>
        ) : null}

        {activeGroup ? (
          <div className="overflow-hidden rounded-xl border border-border divide-y divide-border">
            {activeGroup.rows.map((row) => {
              const selected = row.id === tireSetId;
              const chain = formatSessionChain(row.chainItems);
              return (
                <button
                  key={row.id}
                  type="button"
                  className={rowClass(selected)}
                  aria-pressed={selected}
                  onClick={() => handleSelectRow(row)}
                >
                  <span className="w-16 shrink-0 font-mono text-sm font-medium tabular-nums text-foreground">
                    {row.runCount} {row.runCount === 1 ? "run" : "runs"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {chain || (row.lastUsedAt ? "—" : "not used yet")}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {row.lastRating != null ? (
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {row.lastRating}/10
                      </span>
                    ) : null}
                    {row.lastUsedAt ? (
                      <RelativeTime iso={row.lastUsedAt} fallback="" className="text-[10px]" />
                    ) : null}
                  </span>
                </button>
              );
            })}
            {activeGroup.tireTypeId ? (
              <button
                type="button"
                className={rowClass(newSelected)}
                aria-pressed={newSelected}
                onClick={() => handleNewSet(activeGroup)}
              >
                <span className="w-16 shrink-0 font-mono text-sm font-medium text-foreground">NEW</span>
                <span className="min-w-0 flex-1 truncate text-left text-[11px] text-muted-foreground">
                  first run on a fresh set
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {copyTireWarning ? <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div> : null}

      {hasSelection ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground leading-snug">
            This log is{" "}
            <span className="font-medium text-foreground">run #{runsCompleted + 1}</span>
            {newSelected ? " on a fresh set" : " on these"}
            {newSelected && runsCompleted > 0
              ? ` — counting ${runsCompleted} unlogged prior run${runsCompleted === 1 ? "" : "s"}`
              : runsCompleted === 0
                ? " — first run on them"
                : ""}
            .
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
