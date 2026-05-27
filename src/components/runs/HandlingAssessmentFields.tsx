"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  buildPrimaryFocusOptions,
  HANDLING_TRAIT_AXIS_UI,
  type HandlingAssessmentUiState,
  type HandlingTraitAxisKey,
  type PhaseBalance,
  type PrimaryFocus,
  sanitizeHandlingUiState,
} from "@/lib/runHandlingAssessment";

const PHASE_ROWS: {
  stateKey: "balanceEntry" | "balanceMid" | "balanceExit";
  label: string;
}[] = [
  { stateKey: "balanceEntry", label: "Entry" },
  { stateKey: "balanceMid", label: "Mid" },
  { stateKey: "balanceExit", label: "Exit" },
];

const TRAIT_AXIS_KEYS: HandlingTraitAxisKey[] = [
  "feelSteering",
  "feelGeneral",
  "driveEase",
  "tractionRoll",
];

const PHASE_BALANCE_LEVELS: PhaseBalance[] = [-3, -2, -1, 0, 1, 2, 3];

function patch(next: HandlingAssessmentUiState): HandlingAssessmentUiState {
  return sanitizeHandlingUiState(next);
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

function primaryFocusSelectValue(ui: HandlingAssessmentUiState): string {
  if (!ui.primaryFocus) return "";
  const id = JSON.stringify(ui.primaryFocus);
  const opts = buildPrimaryFocusOptions(ui);
  return opts.some((o) => o.id === id) ? id : "";
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange: (next: HandlingAssessmentUiState) => void;
};

export function HandlingAssessmentFields({ value, onChange }: Props) {
  const primaryFocusOptions = useMemo(() => buildPrimaryFocusOptions(value), [value]);
  const primaryFocusValue = primaryFocusSelectValue(value);

  function emit(next: HandlingAssessmentUiState) {
    onChange(patch(next));
  }

  function setPhaseBalance(
    stateKey: "balanceEntry" | "balanceMid" | "balanceExit",
    n: PhaseBalance
  ) {
    const cur = value[stateKey];
    emit({
      ...value,
      [stateKey]: cur === n ? null : n,
    });
  }

  function setTraitAxis(axis: HandlingTraitAxisKey, n: PhaseBalance) {
    const cur = value[axis];
    emit({
      ...value,
      [axis]: cur === n ? null : n,
    });
  }

  return (
    <div className="space-y-4 rounded-md border border-border/80 bg-muted/30 p-3">
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Corner balance (−3 push → +3 oversteer, per phase)
        </div>
        {PHASE_ROWS.map(({ stateKey, label }) => {
          const rowVal = value[stateKey];
          return (
            <div
              key={stateKey}
              className="flex flex-col gap-2 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
            >
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
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Handling traits (−3 left label → +3 right label; same as corner chips)
        </div>
        {TRAIT_AXIS_KEYS.map((axisKey) => {
          const meta = HANDLING_TRAIT_AXIS_UI[axisKey];
          const rowVal = value[axisKey];
          return (
            <div
              key={axisKey}
              className="space-y-1 border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
            >
              <span className="text-[11px] font-medium text-foreground">{meta.title}</span>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-red-600/90 dark:text-red-400/90">{meta.neg}</span>
                {PHASE_BALANCE_LEVELS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={rowVal === n}
                    className={phaseBalanceChipClass(n, rowVal)}
                    onClick={() => setTraitAxis(axisKey, n)}
                  >
                    {n > 0 ? `+${n}` : String(n)}
                  </button>
                ))}
                <span className="text-[10px] text-emerald-700/90 dark:text-emerald-400/90">{meta.pos}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">Tap again to clear.</p>
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-primary-focus">
          Primary focus (main problem or priority)
        </label>
        <select
          id="handling-primary-focus"
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none disabled:opacity-60"
          disabled={primaryFocusOptions.length === 0}
          value={primaryFocusValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) {
              emit({ ...value, primaryFocus: null });
              return;
            }
            try {
              const parsed = JSON.parse(raw) as PrimaryFocus;
              emit({ ...value, primaryFocus: parsed });
            } catch {
              emit({ ...value, primaryFocus: null });
            }
          }}
        >
          <option value="">
            {primaryFocusOptions.length === 0
              ? "Select other options first"
              : "None selected"}
          </option>
          {primaryFocusOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
