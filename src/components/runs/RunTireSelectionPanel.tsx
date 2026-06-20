"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { tireSetDisplayLine } from "@/lib/tires/tireSelectionFromSet";
import { TireTypeCombobox, type TireTypeOption } from "@/components/tires/TireTypeCombobox";
import { TireSetSelect } from "@/components/runs/TireSetSelect";

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

type Props = {
  tireSets: RunTireSetOption[];
  tireSetId: string;
  onSelectExistingSet: (setId: string, set: RunTireSetOption | null) => void;
  selectedTireTypeId: string;
  onTireTypeIdChange: (id: string) => void;
  onSelectedTireTypeChange: (type: TireTypeOption | null) => void;
  tireSetNumber: string;
  onTireSetNumberChange: (value: string) => void;
  tireSpecificModel: string;
  onTireSpecificModelChange: (value: string) => void;
  resolvingTireSet: boolean;
  runsCompleted: number;
  onRunsCompletedChange: (value: number) => void;
  onRunsCompletedUserTouched: () => void;
  skipTireResolveRef: React.MutableRefObject<boolean>;
  onPrefillClear?: () => void;
  copyTireWarning?: string | null;
  prefillFieldClass?: string;
};

function chipClass(selected: boolean) {
  return cn(
    "rounded-md border px-2.5 py-1.5 text-xs font-medium transition text-left max-w-full truncate",
    selected
      ? "border-accent bg-accent/15 text-foreground"
      : "border-border bg-secondary text-foreground hover:bg-muted"
  );
}

export function RunTireSelectionPanel({
  tireSets,
  tireSetId,
  onSelectExistingSet,
  selectedTireTypeId,
  onTireTypeIdChange,
  onSelectedTireTypeChange,
  tireSetNumber,
  onTireSetNumberChange,
  tireSpecificModel,
  onTireSpecificModelChange,
  resolvingTireSet,
  runsCompleted,
  onRunsCompletedChange,
  onRunsCompletedUserTouched,
  skipTireResolveRef,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: Props) {
  const [showNewSetPanel, setShowNewSetPanel] = useState(false);
  const [recentSets, setRecentSets] = useState<RunTireSetOption[]>([]);
  const [recentSetsLoaded, setRecentSetsLoaded] = useState(false);
  const [recentTypes, setRecentTypes] = useState<TireTypeOption[]>([]);
  const prevResolvingRef = useRef(resolvingTireSet);
  const defaultTireSetAppliedRef = useRef(false);

  const loadRecentSets = useCallback(async () => {
    try {
      const res = await fetch("/api/tire-sets/recent", { cache: "no-store" });
      const data = (await res.json()) as { tireSets?: RunTireSetOption[] };
      setRecentSets(data.tireSets ?? []);
    } catch {
      setRecentSets([]);
    } finally {
      setRecentSetsLoaded(true);
    }
  }, []);

  const loadRecentTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/tire-types/recent", { cache: "no-store" });
      const data = (await res.json()) as { tireTypes?: TireTypeOption[] };
      setRecentTypes(data.tireTypes ?? []);
    } catch {
      setRecentTypes([]);
    }
  }, []);

  useEffect(() => {
    void loadRecentSets();
  }, [loadRecentSets, tireSets.length]);

  useEffect(() => {
    if (showNewSetPanel) void loadRecentTypes();
  }, [showNewSetPanel, loadRecentTypes]);

  useEffect(() => {
    if (selectedTireTypeId && !tireSetId) {
      setShowNewSetPanel(true);
    }
  }, [selectedTireTypeId, tireSetId]);

  useEffect(() => {
    if (tireSetId) setShowNewSetPanel(false);
  }, [tireSetId]);

  useEffect(() => {
    const wasResolving = prevResolvingRef.current;
    prevResolvingRef.current = resolvingTireSet;
    if (wasResolving && !resolvingTireSet && tireSetId && showNewSetPanel) {
      setShowNewSetPanel(false);
    }
  }, [resolvingTireSet, tireSetId, showNewSetPanel]);

  const sortedSets = useMemo(() => {
    const recentIds = new Set(recentSets.map((s) => s.id));
    const recentInCatalog = recentSets.filter((rs) => tireSets.some((ts) => ts.id === rs.id));
    const rest = tireSets
      .filter((ts) => !recentIds.has(ts.id))
      .sort((a, b) => tireSetDisplayLine(a).localeCompare(tireSetDisplayLine(b)));
    return [...recentInCatalog, ...rest];
  }, [tireSets, recentSets]);

  function handleSelectSet(nextId: string) {
    skipTireResolveRef.current = true;
    const ts = tireSets.find((t) => t.id === nextId) ?? null;
    onSelectExistingSet(nextId, ts);
    onPrefillClear?.();
    setShowNewSetPanel(false);
  }

  useEffect(() => {
    if (
      defaultTireSetAppliedRef.current ||
      !recentSetsLoaded ||
      recentSets.length === 0 ||
      tireSetId ||
      showNewSetPanel ||
      sortedSets.length === 0
    ) {
      return;
    }
    defaultTireSetAppliedRef.current = true;
    handleSelectSet(sortedSets[0].id);
  }, [recentSetsLoaded, recentSets.length, tireSetId, showNewSetPanel, sortedSets]);

  function openNewSet() {
    skipTireResolveRef.current = true;
    onSelectExistingSet("", null);
    onTireTypeIdChange("");
    onSelectedTireTypeChange(null);
    onTireSetNumberChange("");
    onTireSpecificModelChange("");
    setShowNewSetPanel(true);
  }

  function cancelNewSet() {
    setShowNewSetPanel(false);
    onTireTypeIdChange("");
    onSelectedTireTypeChange(null);
    onTireSetNumberChange("");
    onTireSpecificModelChange("");
  }

  function pickRecentType(id: string, option: TireTypeOption) {
    skipTireResolveRef.current = false;
    onTireTypeIdChange(id);
    onSelectedTireTypeChange(option);
    onSelectExistingSet("", null);
  }

  return (
    <div className="space-y-3 text-sm">
      <div className={cn("space-y-2", prefillFieldClass)}>
        <div className="flex items-end justify-between gap-3">
          <Eyebrow dot="muted">Tire set</Eyebrow>
          {!showNewSetPanel ? (
            <button type="button" className="btn-surface px-3 py-1.5 text-xs shrink-0" onClick={openNewSet}>
              New set
            </button>
          ) : (
            <button type="button" className="btn-surface px-3 py-1.5 text-xs shrink-0" onClick={cancelNewSet}>
              Cancel
            </button>
          )}
        </div>

        {!showNewSetPanel ? (
          <>
            <TireSetSelect
              value={tireSetId}
              onChange={handleSelectSet}
              options={sortedSets.map((ts) => ({
                id: ts.id,
                label: tireSetDisplayLine(ts),
              }))}
              placeholder={tireSets.length === 0 ? "No saved sets yet" : "Select tire set…"}
              disabled={tireSets.length === 0}
              aria-label="Tire set"
            />

            {tireSets.length === 0 ? (
              <p className="text-[11px] text-muted-foreground leading-snug">
                No tire sets saved yet. Tap <span className="font-medium text-foreground">New set</span> to log
                your first compound.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {showNewSetPanel ? (
        <div className="inset-panel p-3 space-y-3">
          <div className="space-y-1">
            <div className="ui-title text-xs text-muted-foreground">New tire set</div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Pick a compound you&apos;ve used, search the catalog, or add a new type in{" "}
              <Link href="/tires" className="text-accent underline">
                Garage → Tires
              </Link>
              .
            </p>
          </div>

          {recentTypes.length > 0 ? (
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-faint">Recently used types</div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Recently used tire types">
                {recentTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={chipClass(selectedTireTypeId === t.id)}
                    onClick={() => pickRecentType(t.id, t)}
                  >
                    {t.displayName}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-faint">Search catalog</div>
            <TireTypeCombobox
              value={selectedTireTypeId}
              onChange={(id) => {
                skipTireResolveRef.current = false;
                onTireTypeIdChange(id);
                onSelectExistingSet("", null);
              }}
              onSelectedTypeChange={onSelectedTireTypeChange}
              placeholder="Search tire type"
              aria-label="Tire type"
            />
          </div>

          {selectedTireTypeId ? (
            <>
              <div className="space-y-1">
                <label className="block ui-label-meta font-medium">Specific model (optional)</label>
                <input
                  className="form-control w-full px-3 py-2 text-sm"
                  placeholder="e.g. premount, SKU, batch"
                  value={tireSpecificModel}
                  onChange={(e) => onTireSpecificModelChange(e.target.value)}
                  aria-label="Specific tire model"
                />
              </div>

              <div className="space-y-1">
                <label className="block ui-label-meta font-medium">Set number</label>
                <input
                  type="number"
                  min={1}
                  className="w-full max-w-xs form-control px-3 py-2 text-sm"
                  placeholder="e.g. 3"
                  value={tireSetNumber}
                  onChange={(e) => onTireSetNumberChange(e.target.value)}
                  aria-label="Tire set number"
                  autoFocus
                />
                {resolvingTireSet ? (
                  <p className="text-[11px] text-muted-foreground">Linking tire set…</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Creates or links a set for this compound and number.
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">Select a tire type to continue.</p>
          )}
        </div>
      ) : null}

      {copyTireWarning ? <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div> : null}

      {tireSetId ? (
        <div className="space-y-1 text-sm">
          <Eyebrow dot="muted">Prior runs on this set (before this log)</Eyebrow>
          <input
            type="number"
            min={0}
            className="w-full max-w-md form-control px-3 py-2 text-sm"
            inputMode="numeric"
            value={runsCompleted}
            onChange={(e) => {
              onRunsCompletedUserTouched();
              onRunsCompletedChange(Math.max(0, Math.floor(Number(e.target.value) || 0)));
            }}
            aria-label="Prior runs on this tire set before this log"
          />
          <div className="text-[11px] text-muted-foreground">
            This log saves as{" "}
            <span className="font-medium text-foreground">tire run #{runsCompleted + 1}</span>
            {runsCompleted === 0
              ? " (first run on this set)."
              : runsCompleted === 1
                ? " (after 1 prior run on this set)."
                : ` (after ${runsCompleted} prior runs on this set).`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
