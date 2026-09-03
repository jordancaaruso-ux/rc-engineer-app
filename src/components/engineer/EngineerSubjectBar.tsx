"use client";

import { Globe, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-width subject bar above the composer (founder interview 2026-07-30; back on 2026-09-03):
 * two segments — the run the Engineer reads (Auto = your latest, or a pinned one) and General
 * (theory only, nothing from your logs attached). Exactly one segment is lit; the lit segment IS
 * the answer to "what is the Engineer talking about", so it never restates the subject in prose.
 *
 * Every state here is something the Engineer actually does: Auto and a pinned run are the run
 * `driverData.ts` reads, General is the request it sends when no run is attached. The 07-30
 * bar's setup / event pins, compare pairs and "about which car" chips are not back — the
 * rebuilt Engineer has no notion of them, and a bar that pretended to steer it would lie.
 */
export function EngineerSubjectBar({
  mode,
  pinnedLabel,
  autoLabel,
  disabled = false,
  onOpenPicker,
  onClearPin,
  onSelectData,
  onSelectGeneral,
}: {
  /** Which segment is lit. */
  mode: "data" | "general";
  /** The pinned run's label; null = Auto. */
  pinnedLabel: string | null;
  /** Label of the run the Engineer reads when nothing is pinned; null = no runs yet. */
  autoLabel: string | null;
  disabled?: boolean;
  onOpenPicker: () => void;
  onClearPin: () => void;
  /** Unlit data segment tapped — leave General, back to Auto. */
  onSelectData: () => void;
  /** Unlit General segment tapped — theory only. */
  onSelectGeneral: () => void;
}) {
  return (
    // Demo walkthrough stop 5 — what the Engineer has attached to the conversation.
    <div
      role="group"
      aria-label="Engineer subject"
      data-tour="engineer-subject"
      className="flex w-full items-stretch gap-1 rounded-lg border border-border bg-secondary p-1"
    >
      {mode === "data" ? (
        pinnedLabel ? (
          <span className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-primary-ink/50 bg-primary/10 py-1 pl-2 pr-1 text-[11px] text-foreground">
            <Pin className="size-3 shrink-0 text-primary-ink" strokeWidth={2.25} aria-hidden />
            <button
              type="button"
              onClick={onOpenPicker}
              disabled={disabled}
              className="tap-active min-w-0 flex-1 truncate text-left"
              aria-label={`Pinned to ${pinnedLabel} — change run`}
            >
              <span className="truncate">{pinnedLabel}</span>
            </button>
            <button
              type="button"
              onClick={onClearPin}
              disabled={disabled}
              aria-label="Unpin — back to your latest run"
              className="tap-active shrink-0 rounded-full p-0.5 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2.25} aria-hidden />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenPicker}
            disabled={disabled}
            aria-label={
              autoLabel
                ? `Engineer is reading ${autoLabel} — tap to pin a run`
                : "No runs yet — tap to browse"
            }
            className={cn(
              "tap-active flex min-w-0 flex-1 items-center gap-1 rounded-md border border-dashed border-border",
              "bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-primary-ink/50 hover:text-foreground"
            )}
          >
            <span className="shrink-0 ui-title text-[9px]">Auto</span>
            <span className="min-w-0 truncate">{autoLabel ?? "No runs yet"}</span>
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={onSelectData}
          disabled={disabled}
          aria-label="Switch this chat back onto your runs"
          className="tap-active flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          <span className="min-w-0 truncate">{autoLabel ? `Run · ${autoLabel}` : "Run"}</span>
        </button>
      )}

      {mode === "general" ? (
        <span className="flex max-w-[60%] shrink-0 items-center gap-1 rounded-md border border-primary-ink/50 bg-primary/10 px-2 py-1 text-[11px] text-foreground">
          <Globe className="size-3 shrink-0 text-primary-ink" strokeWidth={2.25} aria-hidden />
          <span className="min-w-0 truncate">General</span>
        </span>
      ) : (
        <button
          type="button"
          onClick={onSelectGeneral}
          disabled={disabled}
          aria-label="Ask a general question — nothing from your logs attached"
          className="tap-active flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          <Globe className="size-3 shrink-0" strokeWidth={2.25} aria-hidden />
          <span>General</span>
        </button>
      )}
    </div>
  );
}
