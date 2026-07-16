"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { Drop, Gauge, Timer, Tire, Wrench } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { WIZARD_STEPS, type WizardStepId } from "@/lib/runs/wizardWalk";

/**
 * Jumpable icon rail for the Log-run wizard (founder spec 2026-07-16 v2): all
 * steps always visible and tappable; the walk (after-run + declared changed)
 * is bright, carried-over steps are dimmed but reachable; the current step
 * gets the yellow active treatment; completed steps get a ✓ badge. A dashed
 * divider marks the pre-run → after-run seam (before Laps).
 */

const STEP_ICONS: Record<WizardStepId, PhosphorIcon> = {
  equipment: Tire,
  prep: Drop,
  setup: Wrench,
  laps: Timer,
  feel: Gauge,
};

export type WizardStepStatus = {
  /** Show a ✓ badge — the step's key data is in. */
  done?: boolean;
  /** Show an attention dot — required data still missing at Run complete. */
  attention?: boolean;
};

export function LogRunWizardRail({
  current,
  walk,
  continuing,
  statusById,
  onSelect,
}: {
  current: WizardStepId;
  walk: readonly WizardStepId[];
  continuing: boolean;
  statusById?: Partial<Record<WizardStepId, WizardStepStatus>>;
  onSelect: (id: WizardStepId) => void;
}) {
  const walkSet = new Set(walk);
  // One template column per step, plus a thin divider column at the seam.
  const cells: Array<WizardStepId | "seam"> = [];
  WIZARD_STEPS.forEach((s, i) => {
    cells.push(s.id);
    const next = WIZARD_STEPS[i + 1];
    if (s.preRun && next && !next.preRun) cells.push("seam");
  });
  const template = cells.map((c) => (c === "seam" ? "8px" : "1fr")).join(" ");

  return (
    <div
      className="grid gap-1 rounded-xl border border-border bg-card/70 p-1.5"
      style={{ gridTemplateColumns: template }}
      role="tablist"
      aria-label="Log run steps"
    >
      {cells.map((c, i) => {
        if (c === "seam") {
          return (
            <div
              key={`seam-${i}`}
              aria-hidden
              className="my-1 w-px justify-self-center [background:repeating-linear-gradient(to_bottom,var(--color-border)_0_4px,transparent_4px_8px)]"
            />
          );
        }
        const s = WIZARD_STEPS[WIZARD_STEPS.findIndex((x) => x.id === c)];
        const Icon = STEP_ICONS[s.id];
        const cur = s.id === current;
        const carried = continuing && !walkSet.has(s.id);
        const st = statusById?.[s.id];
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={cur}
            aria-label={`${s.label}${cur ? " (current)" : carried ? " (carried over)" : ""}`}
            onClick={() => onSelect(s.id)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 rounded-lg px-0.5 py-1.5 transition-colors",
              cur
                ? "bg-primary text-primary-foreground"
                : carried
                  ? "text-faint hover:text-muted-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="relative">
              <Icon size={19} weight={cur ? "fill" : "regular"} aria-hidden />
              {st?.attention ? (
                <span
                  className="absolute -right-1.5 -top-1 h-2 w-2 rounded-full bg-amber-400"
                  aria-hidden
                />
              ) : st?.done && !cur ? (
                <span
                  className="absolute -right-2 -top-1 text-[9px] font-bold leading-none text-[#4FD089]"
                  aria-hidden
                >
                  ✓
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                "font-sans text-[9px] leading-none tracking-tight",
                cur ? "font-bold" : "font-medium",
              )}
            >
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
