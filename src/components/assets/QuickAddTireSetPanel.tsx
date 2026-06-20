"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { TireTypeCombobox, type TireTypeOption } from "@/components/tires/TireTypeCombobox";
import { createTireSetApi, type TireSetApiRow } from "@/lib/assets/createAssetApi";

export function QuickAddTireSetPanel({
  onCreated,
  onCancel,
  className,
  submitLabel = "Add tire set",
}: {
  onCreated: (tireSet: TireSetApiRow) => void;
  onCancel?: () => void;
  className?: string;
  submitLabel?: string;
}) {
  const [tireTypeId, setTireTypeId] = useState("");
  const [selectedType, setSelectedType] = useState<TireTypeOption | null>(null);
  const [setNumber, setSetNumber] = useState("");
  const [specificModel, setSpecificModel] = useState("");
  const [initialRunCount, setInitialRunCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setParsed = parseInt(setNumber.trim(), 10);
  const canSubmit = Boolean(tireTypeId && Number.isFinite(setParsed) && setParsed >= 1);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tireTypeId || !canSubmit) {
      setError("Pick a tire type and set number.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const tireSet = await createTireSetApi({
        tireTypeId,
        setNumber: setParsed,
        initialRunCount: initialRunCount >= 0 ? Math.floor(initialRunCount) : 0,
        specificModel: specificModel.trim() || null,
      });
      onCreated(tireSet);
      setTireTypeId("");
      setSelectedType(null);
      setSetNumber("");
      setSpecificModel("");
      setInitialRunCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tire set");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn("inset-panel p-3 space-y-3", className)}>
      <div className="space-y-1">
        <div className="ui-title text-xs text-muted-foreground">New tire set</div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Search the catalog or type a new compound — tap <span className="font-medium text-foreground">Create…</span>{" "}
          in the list if it is not there yet.
        </p>
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-faint">Tire type</div>
        <TireTypeCombobox
          value={tireTypeId}
          onChange={setTireTypeId}
          onSelectedTypeChange={setSelectedType}
          placeholder="Search or add tire type"
          aria-label="Tire type"
        />
        {selectedType ? (
          <p className="text-[11px] text-muted-foreground">Selected: {selectedType.displayName}</p>
        ) : null}
      </div>

      {tireTypeId ? (
        <>
          <div className="space-y-1">
            <label className="block ui-label-meta font-medium">Specific model (optional)</label>
            <input
              className="form-control w-full px-3 py-2 text-sm"
              placeholder="e.g. premount, SKU, batch"
              value={specificModel}
              onChange={(e) => setSpecificModel(e.target.value)}
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
              value={setNumber}
              onChange={(e) => setSetNumber(e.target.value)}
              aria-label="Tire set number"
              autoFocus
            />
          </div>

          <div className="space-y-1 text-sm">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-faint">
              Prior runs on this set (before first log)
            </div>
            <input
              type="number"
              min={0}
              className="form-control w-full max-w-xs px-3 py-2 text-sm"
              inputMode="numeric"
              value={initialRunCount}
              onChange={(e) => setInitialRunCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              aria-label="Prior runs on this tire set before first log"
            />
            <div className="text-[11px] text-muted-foreground">
              First log on this set will be{" "}
              <span className="font-medium text-foreground">tire run #{initialRunCount + 1}</span>.
            </div>
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Select or create a tire type to continue.</p>
      )}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!canSubmit || creating}>
          {creating ? "Adding…" : submitLabel}
        </Button>
        {onCancel ? (
          <button
            type="button"
            className="btn-surface px-3 py-1.5 text-xs"
            onClick={onCancel}
            disabled={creating}
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
