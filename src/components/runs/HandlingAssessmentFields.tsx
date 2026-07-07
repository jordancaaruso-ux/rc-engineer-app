"use client";

import { useMemo, useState } from "react";
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

const PHASE_BALANCE_INFO =
  "US (understeer) = the front washes out and the car won't turn in. OS (oversteer) = the rear steps out and the car rotates too much. Mark how it felt through this part of the corner; the centre is neutral.";

const TRAIT_AXIS_INFO: Record<HandlingTraitAxisKey, string> = {
  feelSteering:
    "How sharp the steering response feels — dull and muted at one end, sharp and aggressive at the other.",
  feelGeneral:
    "The car's overall demeanour — smooth and calm at one end, reactive and twitchy at the other.",
  driveEase:
    "How demanding the car is to drive at pace — hard and punishing at one end, easy and forgiving at the other.",
  tractionRoll:
    "How often the car trips over its tyres and traction-rolls — never at one end, often at the other.",
};

function patch(next: HandlingAssessmentUiState): HandlingAssessmentUiState {
  return sanitizeHandlingUiState(next);
}

/** Circle diameter grows toward the extremes (16personalities-style). */
function circleSizeClass(n: PhaseBalance): string {
  switch (Math.abs(n)) {
    case 3:
      return "h-8 w-8";
    case 2:
      return "h-6 w-6";
    case 1:
      return "h-5 w-5";
    default:
      return "h-4 w-4";
  }
}

/** Ring/fill color by pole: red (negative) → grey (neutral) → green (positive). */
function circleColorClass(n: PhaseBalance, selected: boolean): string {
  if (n < 0) {
    return selected
      ? "border-destructive bg-destructive"
      : "border-destructive/60 hover:border-destructive hover:bg-destructive/10";
  }
  if (n > 0) {
    return selected
      ? "border-emerald-500 bg-emerald-500"
      : "border-emerald-500/60 hover:border-emerald-500 hover:bg-emerald-500/10";
  }
  return selected
    ? "border-muted-foreground bg-muted-foreground"
    : "border-muted-foreground/40 hover:border-muted-foreground/70 hover:bg-muted/60";
}

function BalanceCircleScale({
  title,
  info,
  negLabel,
  posLabel,
  current,
  onSelect,
}: {
  title: string;
  info: string;
  negLabel: string;
  posLabel: string;
  current: PhaseBalance | null;
  onSelect: (n: PhaseBalance) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-foreground">{title}</span>
        <button
          type="button"
          aria-label={`What does ${title} mean?`}
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen((v) => !v)}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold leading-none transition",
            infoOpen
              ? "border-foreground/50 bg-muted text-foreground"
              : "border-muted-foreground/40 text-muted-foreground hover:border-foreground/50 hover:text-foreground"
          )}
        >
          i
        </button>
      </div>
      {infoOpen ? (
        <p className="text-[10px] leading-snug text-muted-foreground">{info}</p>
      ) : null}
      <div className="flex items-center" role="radiogroup" aria-label={title}>
        <span className="w-14 shrink-0 pr-2 text-right text-[10px] font-medium text-destructive/90">
          {negLabel}
        </span>
        <div className="flex flex-1 items-center justify-between px-1">
          {PHASE_BALANCE_LEVELS.map((n) => {
            const selected = current === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${n > 0 ? `+${n}` : n} (${
                  n < 0 ? negLabel : n > 0 ? posLabel : "neutral"
                })`}
                onClick={() => onSelect(n)}
                className={cn(
                  "rounded-full border-2 bg-transparent transition",
                  circleSizeClass(n),
                  circleColorClass(n, selected)
                )}
              />
            );
          })}
        </div>
        <span className="w-14 shrink-0 pl-2 text-left text-[10px] font-medium text-emerald-700/90 dark:text-emerald-400/90">
          {posLabel}
        </span>
      </div>
    </div>
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
    <div className="space-y-4 inset-panel p-3">
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Corner balance (understeer → oversteer, per phase)
        </div>
        {PHASE_ROWS.map(({ stateKey, label }) => {
          const rowVal = value[stateKey];
          return (
            <div
              key={stateKey}
              className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
            >
              <BalanceCircleScale
                title={label}
                info={PHASE_BALANCE_INFO}
                negLabel="US"
                posLabel="OS"
                current={rowVal}
                onSelect={(n) => setPhaseBalance(stateKey, n)}
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Handling traits (rate toward either end)
        </div>
        {TRAIT_AXIS_KEYS.map((axisKey) => {
          const meta = HANDLING_TRAIT_AXIS_UI[axisKey];
          const rowVal = value[axisKey];
          return (
            <div
              key={axisKey}
              className="border-t border-border/50 pt-3 first:border-t-0 first:pt-0"
            >
              <BalanceCircleScale
                title={meta.title}
                info={TRAIT_AXIS_INFO[axisKey]}
                negLabel={meta.neg}
                posLabel={meta.pos}
                current={rowVal}
                onSelect={(n) => setTraitAxis(axisKey, n)}
              />
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
          className="form-control w-full px-2 py-1.5 text-xs disabled:opacity-60"
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
