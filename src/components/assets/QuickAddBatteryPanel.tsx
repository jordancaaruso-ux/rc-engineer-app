"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { Button } from "@/components/ui/Button";
import { createBatteryApi, type BatteryApiRow } from "@/lib/assets/createAssetApi";

export function QuickAddBatteryPanel({
  onCreated,
  onCancel,
  className,
  submitLabel = "Add battery pack",
}: {
  onCreated: (battery: BatteryApiRow) => void;
  onCancel?: () => void;
  className?: string;
  submitLabel?: string;
}) {
  const [label, setLabel] = useState("");
  const [packNumber, setPackNumber] = useState("1");
  const [initialRunCount, setInitialRunCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Enter a battery label (e.g. LCG 6000mAh).");
      return;
    }
    const packRaw = packNumber.trim();
    const packParsed = packRaw === "" ? NaN : parseInt(packRaw, 10);
    const pack = Number.isFinite(packParsed) && packParsed >= 1 ? packParsed : 1;
    const priorRuns = initialRunCount >= 0 ? Math.floor(initialRunCount) : 0;

    setCreating(true);
    setError(null);
    try {
      const battery = await createBatteryApi({
        label: trimmed,
        packNumber: pack,
        initialRunCount: priorRuns,
      });
      onCreated(battery);
      setLabel("");
      setPackNumber("1");
      setInitialRunCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create battery");
    } finally {
      setCreating(false);
    }
  }

  function handleEnterKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || e.shiftKey) return;
    e.preventDefault();
    if (!label.trim() || creating) return;
    void handleSubmit();
  }

  return (
    <div className={cn("inset-panel p-3 space-y-3", className)}>
      <div className="space-y-1">
        <Eyebrow>New battery pack</Eyebrow>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Label and pack number — saved to your assets immediately.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="form-control px-3 py-2 text-sm"
          placeholder="Label (e.g. LCG 6000mAh)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={handleEnterKey}
          aria-label="Battery label"
          autoFocus
        />
        <input
          type="number"
          min={1}
          className="form-control px-3 py-2 text-sm"
          placeholder="Pack number"
          value={packNumber}
          onChange={(e) => setPackNumber(e.target.value)}
          onKeyDown={handleEnterKey}
          aria-label="Pack number"
        />
      </div>

      <div className="space-y-1 text-sm">
        <Eyebrow dot="muted">Prior runs on this pack (before first log)</Eyebrow>
        <input
          type="number"
          min={0}
          className="form-control w-full px-3 py-2 text-sm"
          inputMode="numeric"
          value={initialRunCount}
          onChange={(e) => setInitialRunCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
          aria-label="Prior runs on this battery pack before first log"
        />
        <div className="text-[11px] text-muted-foreground">
          First log on this pack will be{" "}
          <span className="font-medium text-foreground">battery run #{initialRunCount + 1}</span>.
        </div>
      </div>

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!label.trim() || creating} onClick={() => void handleSubmit()}>
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
    </div>
  );
}
