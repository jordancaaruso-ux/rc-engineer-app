"use client";

import { Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCopyLastRunCardSummary } from "@/lib/runPickerFormat";
import type { RunPickerRun } from "@/lib/runPickerFormat";
import { Eyebrow } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";

export function CopyLastRunCard({
  run,
  applied,
  onApply,
  timeZone,
  disabled = false,
}: {
  run: RunPickerRun;
  applied: boolean;
  onApply: () => void;
  timeZone?: string | null;
  /** Form apply handler not registered yet — card visible but not tappable. */
  disabled?: boolean;
}) {
  const summary = formatCopyLastRunCardSummary(run, timeZone);
  const inactive = applied || disabled;

  return (
    <button
      type="button"
      disabled={inactive}
      onClick={onApply}
      aria-label={applied ? "Last run details applied to this form" : "Use last run details to pre-fill this form"}
      className={cn(
        "group/copy w-full text-left tap-active",
        applied ? "cursor-default" : disabled ? "cursor-wait" : "cursor-pointer"
      )}
    >
      <SurfaceCard
        variant="panel"
        glowMode={inactive ? "none" : "idle-drift"}
        muted={applied}
        className={cn(
          "transition-shadow duration-300",
          !inactive && "group-hover/copy:shadow-[0_22px_56px_-26px_rgba(0,0,0,0.8)]",
          disabled && !applied && "opacity-90"
        )}
        contentClassName="flex items-center gap-3"
      >
        <span
          aria-hidden
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-runna-inset text-muted-foreground transition-colors",
            !applied && "group-hover/copy:border-primary/35 group-hover/copy:text-accent"
          )}
        >
          <Copy className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <Eyebrow dot="accent">Last run</Eyebrow>
          <p
            className={cn(
              "mt-2 text-[13px] leading-relaxed break-words",
              applied ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {summary}
          </p>
          {applied ? (
            <p className="mt-1.5 type-data-label">
              Applied
            </p>
          ) : disabled ? (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Loading form…</p>
          ) : (
            <p className="mt-1.5 text-[11px] text-muted-foreground">Tap to pre-fill from this run</p>
          )}
        </div>
      </SurfaceCard>
    </button>
  );
}
