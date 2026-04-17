"use client";

import { cn } from "@/lib/utils";
import {
  HANDLING_TRAIT_LABELS,
  HANDLING_TRAIT_TAG_IDS,
  type CornerPhase,
  type FeelVsLastRun,
  type HandlingAssessmentUiState,
  type PhaseBalance,
  type HandlingTraitTagId,
} from "@/lib/runHandlingAssessment";
import { HandlingCornerAnimation } from "@/components/runs/HandlingCornerAnimation";

const PHASE_ROWS: {
  stateKey: "balanceEntry" | "balanceMid" | "balanceExit";
  label: string;
  phase: CornerPhase;
}[] = [
  { stateKey: "balanceEntry", label: "Entry", phase: "entry" },
  { stateKey: "balanceMid", label: "Mid", phase: "mid" },
  { stateKey: "balanceExit", label: "Exit", phase: "exit" },
];

const PHASE_BALANCE_LEVELS: PhaseBalance[] = [-3, -2, -1, 0, 1, 2, 3];

const FEEL_VS_LAST_RUN_LEVELS: FeelVsLastRun[] = [-3, -2, -1, 0, 1, 2, 3];

function toggleTrait(tags: HandlingTraitTagId[], id: HandlingTraitTagId): HandlingTraitTagId[] {
  if (tags.includes(id)) return tags.filter((t) => t !== id);
  return [...tags, id];
}

function phaseBalanceChipClass(n: PhaseBalance, current: PhaseBalance | null): string {
  const on = current === n;
  if (!on) {
    return cn(
      "rounded border px-1.5 py-0.5 text-[11px] font-medium transition min-w-[2rem]",
      "border-border bg-card text-muted-foreground hover:text-foreground",
      n < 0 && "hover:border-red-400/50 hover:bg-red-500/5",
      n === 0 && "hover:bg-muted/80",
      n > 0 && "hover:border-emerald-500/50 hover:bg-emerald-500/5"
    );
  }
  return cn(
    "rounded border px-1.5 py-0.5 text-[11px] font-medium min-w-[2rem]",
    n < 0 && "border-red-500/70 bg-red-500/15 text-foreground",
    n === 0 && "border-muted-foreground/60 bg-muted text-foreground",
    n > 0 && "border-emerald-600/70 bg-emerald-500/15 text-foreground"
  );
}

function feelVsLastRunButtonClass(n: FeelVsLastRun, current: FeelVsLastRun | null): string {
  return phaseBalanceChipClass(n, current);
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange: (next: HandlingAssessmentUiState) => void;
  feelVsLastRunEligible?: boolean;
};

export function HandlingAssessmentFields({ value, onChange, feelVsLastRunEligible = false }: Props) {
  function setPhaseBalance(
    stateKey: "balanceEntry" | "balanceMid" | "balanceExit",
    n: PhaseBalance
  ) {
    const cur = value[stateKey];
    onChange({
      ...value,
      [stateKey]: cur === n ? null : n,
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-border/80 bg-muted/30 p-3">
      {feelVsLastRunEligible ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Compared to your last run on this car
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-red-600/90 dark:text-red-400/90 mr-0.5">Worse</span>
            {FEEL_VS_LAST_RUN_LEVELS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={value.feelVsLastRun === n}
                className={feelVsLastRunButtonClass(n, value.feelVsLastRun)}
                onClick={() =>
                  onChange({
                    ...value,
                    feelVsLastRun: value.feelVsLastRun === n ? null : n,
                  })
                }
              >
                {n > 0 ? `+${n}` : String(n)}
              </button>
            ))}
            <span className="text-[10px] text-emerald-700/90 dark:text-emerald-400/90 ml-0.5">Better</span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Tap again to clear. 0 = same as last time on this car.
          </p>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground">
          Log at least one prior run on this car to rate feel vs last run.
        </p>
      )}

      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Corner balance (−3 push → +3 oversteer, per phase)
        </div>
        {PHASE_ROWS.map(({ stateKey, label, phase }) => {
          const rowVal = value[stateKey];
          return (
            <div
              key={stateKey}
              className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-2 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-foreground">{label}</span>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] text-red-600/90 dark:text-red-400/90">Push</span>
                  {PHASE_BALANCE_LEVELS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={rowVal === n}
                      className={phaseBalanceChipClass(n, rowVal)}
                      onClick={() => setPhaseBalance(stateKey, n)}
                    >
                      {n > 0 ? `+${n}` : String(n)}
                    </button>
                  ))}
                  <span className="text-[10px] text-emerald-700/90 dark:text-emerald-400/90">OS</span>
                </div>
                <p className="text-[10px] text-muted-foreground">Tap again to clear this phase.</p>
              </div>
              {rowVal != null ? (
                <HandlingCornerAnimation phase={phase} balance={rowVal} />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Quick traits</div>
        <div className="flex flex-wrap gap-2">
          {HANDLING_TRAIT_TAG_IDS.map((id) => {
            const on = value.traitTags.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
                onClick={() =>
                  onChange({ ...value, traitTags: toggleTrait(value.traitTags, id) })
                }
              >
                {HANDLING_TRAIT_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-traits-other">
          Other traits
        </label>
        <input
          id="handling-traits-other"
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
          placeholder="Short free text (e.g. snaps on power)…"
          value={value.traitsOther}
          onChange={(e) => onChange({ ...value, traitsOther: e.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-main-problem">
            Main problem to solve
          </label>
          <input
            id="handling-main-problem"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            placeholder="Optional"
            value={value.mainProblem}
            onChange={(e) => onChange({ ...value, mainProblem: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-car-well">
            What the car does well
          </label>
          <input
            id="handling-car-well"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            placeholder="Optional"
            value={value.carDoesWell}
            onChange={(e) => onChange({ ...value, carDoesWell: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
