"use client";

import { Globe, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Full-width subject bar above the composer (founder interview 2026-07-30), replacing
 * the single focus chip: two segments — the data subject (all of the chip's Auto /
 * pinned states, including setup and event pins from deep links) and General (theory
 * only, no run attached). Exactly one segment is lit; the lit segment IS the answer to
 * "what is the Engineer talking about", so it never restates the subject in prose.
 *
 * The car chip row under a lit General segment is deterministic UI — no model
 * round-trip. Picking a car scopes theory to that car's identity, never its data.
 */
export function EngineerSubjectBar({
  mode,
  pinned,
  autoLabel,
  switchOffer,
  generalCarName,
  cars,
  selectedGeneralCarId,
  disabled = false,
  onOpenPicker,
  onClearPin,
  onSwitch,
  onSelectData,
  onSelectGeneral,
  onPickGeneralCar,
}: {
  /** Which segment is lit. */
  mode: "data" | "general";
  /** User pin on the data segment; kindBadge labels non-run pins ("Setup" / "Event"). */
  pinned: { label: string; compareLabel: string | null; kindBadge: string | null } | null;
  /** Label of the run the Engineer talks about when nothing is pinned; null = no runs yet. */
  autoLabel: string | null;
  /** "New run logged — switch?" affordance (data + Auto state only). */
  switchOffer: { label: string } | null;
  /** Car name shown in the lit General segment; null = pure theory. */
  generalCarName: string | null;
  cars: Array<{ id: string; name: string }>;
  selectedGeneralCarId: string | null;
  disabled?: boolean;
  onOpenPicker: () => void;
  onClearPin: () => void;
  onSwitch: () => void;
  /** Unlit data segment tapped — leave General, back to Auto. */
  onSelectData: () => void;
  /** Unlit General segment tapped — theory mode with the remembered car. */
  onSelectGeneral: () => void;
  onPickGeneralCar: (carId: string | null) => void;
}) {
  return (
    // Demo walkthrough stop 5 — what the Engineer has attached to the conversation.
    <div className="space-y-2" data-tour="engineer-subject">
      <div
        role="group"
        aria-label="Engineer subject"
        className="flex w-full items-stretch gap-1 rounded-lg border border-border bg-secondary p-1"
      >
        {mode === "data" ? (
          pinned ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 rounded-md border border-primary-ink/50 bg-primary/10 py-1 pl-2 pr-1 text-[11px] text-foreground">
              <Pin className="size-3 shrink-0 text-primary-ink" strokeWidth={2.25} aria-hidden />
              {pinned.kindBadge ? (
                <span className="shrink-0 rounded border border-border/70 bg-muted/40 px-1 py-px text-[9px] ui-title text-muted-foreground">
                  {pinned.kindBadge}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onOpenPicker}
                disabled={disabled}
                className="tap-active min-w-0 flex-1 truncate text-left"
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
              onClick={onOpenPicker}
              disabled={disabled}
              aria-label={
                autoLabel
                  ? `Engineer is focused on ${autoLabel} — tap to pin or change`
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
            <span className="min-w-0 truncate">
              General
              {generalCarName ? <span className="text-muted-foreground"> · {generalCarName}</span> : null}
            </span>
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

      {mode === "data" && !pinned && switchOffer ? (
        <button
          type="button"
          onClick={onSwitch}
          disabled={disabled}
          className="tap-active rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground transition hover:border-primary-ink/60"
        >
          New run logged — switch?
        </button>
      ) : null}

      {mode === "general" ? (
        <div className="space-y-1">
          <p className="ui-title text-[10px] text-muted-foreground">About which car?</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onPickGeneralCar(null)}
              disabled={disabled}
              className={cn(
                "tap-active rounded-full border px-2 py-0.5 text-[11px] transition",
                selectedGeneralCarId === null
                  ? "border-primary-ink/60 bg-primary/10 text-foreground"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
              )}
            >
              No car — pure theory
            </button>
            {cars.map((car) => (
              <button
                key={car.id}
                type="button"
                onClick={() => onPickGeneralCar(car.id)}
                disabled={disabled}
                className={cn(
                  "tap-active rounded-full border px-2 py-0.5 text-[11px] transition",
                  selectedGeneralCarId === car.id
                    ? "border-primary-ink/60 bg-primary/10 text-foreground"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                )}
              >
                {car.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
