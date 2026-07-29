"use client";

import { Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The Engineer's focus, always visible above the composer (founder interview
 * 2026-07-29): dashed muted = Auto (the guess — tap to pin or change), solid =
 * Pinned (user-set; the model cannot move it). The chip is the acknowledgement —
 * the Engineer never restates the anchor in prose.
 */
export function EngineerFocusChip({
  pinned,
  autoLabel,
  switchOffer,
  disabled = false,
  onOpen,
  onClearPin,
  onSwitch,
}: {
  /** User pin; compareLabel present for a pinned run pair. */
  pinned: { label: string; compareLabel: string | null } | null;
  /** Label of the run the Engineer is talking about when nothing is pinned. */
  autoLabel: string | null;
  /** "New run logged — switch?" affordance (Auto state only; focus never jumps by itself). */
  switchOffer: { label: string } | null;
  disabled?: boolean;
  onOpen: () => void;
  onClearPin: () => void;
  onSwitch: () => void;
}) {
  if (!pinned && !autoLabel) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {pinned ? (
        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/50 bg-primary/10 py-1 pl-2 pr-1 text-[11px] text-foreground">
          <Pin className="size-3 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
          <button
            type="button"
            onClick={onOpen}
            disabled={disabled}
            className="tap-active min-w-0 truncate text-left"
            aria-label={`Pinned to ${pinned.label} — change focus`}
          >
            <span className="truncate">
              {pinned.label}
              {pinned.compareLabel ? (
                <span className="text-muted-foreground"> vs {pinned.compareLabel}</span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            onClick={onClearPin}
            disabled={disabled}
            aria-label="Unpin — back to automatic focus"
            className="tap-active shrink-0 rounded-full p-0.5 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-3" strokeWidth={2.25} aria-hidden />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-label={`Engineer is focused on ${autoLabel} — tap to pin or change`}
          className={cn(
            "tap-active inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-border",
            "bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          )}
        >
          <span className="shrink-0 ui-title text-[9px]">Auto</span>
          <span className="min-w-0 truncate">{autoLabel}</span>
        </button>
      )}
      {!pinned && switchOffer ? (
        <button
          type="button"
          onClick={onSwitch}
          disabled={disabled}
          className="tap-active rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground transition hover:border-primary/60"
        >
          New run logged — switch?
        </button>
      ) : null}
    </div>
  );
}
