"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  onDelete: () => Promise<void>;
  runCount?: number;
  className?: string;
  size?: "xs" | "sm";
};

export function AssetDeleteButton({ label, onDelete, runCount = 0, className, size = "xs" }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = runCount > 0;
  const pad = size === "sm" ? "px-3 py-1.5 text-xs" : "px-2.5 py-1 text-[11px]";

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  if (blocked) {
    return (
      <span
        className={cn("text-muted-foreground", size === "sm" ? "text-xs" : "text-[11px]", className)}
        title={`${runCount} run${runCount === 1 ? "" : "s"} linked`}
      >
        In use
      </span>
    );
  }

  if (confirming) {
    return (
      <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
        <span className={cn("text-muted-foreground", size === "sm" ? "text-xs" : "text-[11px]")}>
          Delete {label}?
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleConfirm()}
          className={cn(
            "rounded-md border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 disabled:opacity-50",
            pad
          )}
        >
          {busy ? "Deleting…" : "Confirm"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          className={cn("btn-surface", pad)}
        >
          Cancel
        </button>
        {error ? <span className="w-full text-[11px] text-destructive">{error}</span> : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setConfirming(true);
        setError(null);
      }}
      className={cn(
        "rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10",
        pad,
        className
      )}
    >
      Delete
    </button>
  );
}
