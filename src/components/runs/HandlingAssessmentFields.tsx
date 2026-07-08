"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  buildPrimaryFocusOptions,
  CAPTURE_TRAIT_AXIS_KEYS,
  HANDLING_SEVERITY_CHIP_LABELS,
  HANDLING_TRAIT_CHIP_META,
  sanitizeHandlingUiState,
  type CaptureTraitAxisKey,
  type CornerSpeed,
  type HandlingAssessmentUiState,
  type HandlingIssueKey,
  type PhaseBalance,
  type PrimaryFocus,
} from "@/lib/runHandlingAssessment";

const PHASE_ROWS: {
  stateKey: "balanceEntry" | "balanceMid" | "balanceExit";
  phase: "entry" | "mid" | "exit";
  label: string;
}[] = [
  { stateKey: "balanceEntry", phase: "entry", label: "Entry" },
  { stateKey: "balanceMid", phase: "mid", label: "Mid" },
  { stateKey: "balanceExit", phase: "exit", label: "Exit" },
];

const PHASE_BALANCE_LEVELS: PhaseBalance[] = [-3, -2, -1, 0, 1, 2, 3];

const PHASE_BALANCE_INFO =
  "US (understeer) = the front washes out and the car won't turn in. OS (oversteer) = the rear steps out and the car rotates too much. Mark how it felt through this part of the corner; the centre is neutral.";

const CORNER_SPEEDS: CornerSpeed[] = ["slow", "fast", "both"];
const SPEED_SHORT: Record<CornerSpeed, string> = { slow: "Slow", fast: "Fast", both: "Both" };
const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/** Flat list of problem chips: bipolar traits (steering feel) contribute two. */
const CHIP_DEFS: Array<{ axis: CaptureTraitAxisKey; sign: -1 | 1; label: string }> =
  CAPTURE_TRAIT_AXIS_KEYS.flatMap((axis) =>
    HANDLING_TRAIT_CHIP_META[axis].problemPoles.map((p) => ({ axis, sign: p.sign, label: p.label }))
  );

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

/** Slow / Fast / Both selector for a flagged issue. Tap the active one to clear. */
function SpeedTagPicker({
  value,
  onChange,
}: {
  value: CornerSpeed | undefined;
  onChange: (next: CornerSpeed | null) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">Where?</span>
      <div className="flex gap-1" role="group" aria-label="Where does it happen">
        {CORNER_SPEEDS.map((s) => {
          const selected = value === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? null : s)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[10px] font-medium transition",
                selected
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface-runna-inset text-muted-foreground hover:text-foreground"
              )}
            >
              {SPEED_SHORT[s]}
            </button>
          );
        })}
      </div>
    </div>
  );
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
    emit({ ...value, [stateKey]: cur === n ? null : n });
  }

  function setSpeed(issueKey: HandlingIssueKey, speed: CornerSpeed | null) {
    const nextTags = { ...value.speedTags };
    if (speed == null) delete nextTags[issueKey];
    else nextTags[issueKey] = speed;
    emit({ ...value, speedTags: nextTags });
  }

  /** Toggle / set a trait chip. sign fixes the problem pole; default severity = moderate. */
  function toggleTraitChip(axis: CaptureTraitAxisKey, sign: -1 | 1) {
    const cur = value[axis];
    const active = cur != null && cur !== 0 && Math.sign(cur) === sign;
    if (active) {
      emit({ ...value, [axis]: null });
      return;
    }
    const severity = cur != null && cur !== 0 ? (Math.abs(cur) as 1 | 2 | 3) : 2;
    emit({ ...value, [axis]: (sign * severity) as PhaseBalance });
  }

  function setTraitSeverity(axis: CaptureTraitAxisKey, severity: 1 | 2 | 3) {
    const cur = value[axis];
    if (cur == null || cur === 0) return;
    const sign = Math.sign(cur);
    emit({ ...value, [axis]: (sign * severity) as PhaseBalance });
  }

  const activeTraitAxes = CAPTURE_TRAIT_AXIS_KEYS.filter((axis) => {
    const v = value[axis];
    return v != null && v !== 0;
  });

  return (
    <div className="space-y-4 inset-panel p-3">
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground">
          Corner balance (understeer → oversteer, per phase)
        </div>
        {PHASE_ROWS.map(({ stateKey, phase, label }) => {
          const rowVal = value[stateKey];
          const flagged = rowVal != null && rowVal !== 0;
          const issueKey = `balance:${phase}` as HandlingIssueKey;
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
              {flagged ? (
                <div className="mt-2 pl-14">
                  <SpeedTagPicker
                    value={value.speedTags[issueKey]}
                    onChange={(s) => setSpeed(issueKey, s)}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Anything notable? (tap only if it was a problem)
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CHIP_DEFS.map(({ axis, sign, label }) => {
            const cur = value[axis];
            const active = cur != null && cur !== 0 && Math.sign(cur) === sign;
            return (
              <button
                key={`${axis}:${sign}`}
                type="button"
                aria-pressed={active}
                onClick={() => toggleTraitChip(axis, sign)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  active
                    ? "border-destructive/70 bg-destructive/15 text-foreground"
                    : "border-border bg-surface-runna-inset text-muted-foreground hover:text-foreground hover:border-destructive/40"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {activeTraitAxes.length > 0 ? (
          <div className="space-y-2 pt-1">
            {activeTraitAxes.map((axis) => {
              const cur = value[axis] as PhaseBalance;
              const sign = Math.sign(cur) as -1 | 1;
              const severity = Math.abs(cur) as 1 | 2 | 3;
              const pole = HANDLING_TRAIT_CHIP_META[axis].problemPoles.find((p) => p.sign === sign);
              const issueKey = `trait:${axis}` as HandlingIssueKey;
              return (
                <div
                  key={axis}
                  className="rounded-md border border-border/60 bg-surface-runna-inset/40 p-2 space-y-2"
                >
                  <div className="text-[11px] font-medium text-foreground">{pole?.label ?? axis}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex gap-1" role="group" aria-label={`${axis} severity`}>
                      {SEVERITIES.map((s) => {
                        const selected = severity === s;
                        return (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setTraitSeverity(axis, s)}
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize transition",
                              selected
                                ? "border-foreground/50 bg-muted text-foreground"
                                : "border-border bg-surface-runna-inset text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {HANDLING_SEVERITY_CHIP_LABELS[s]}
                          </button>
                        );
                      })}
                    </div>
                    <SpeedTagPicker
                      value={value.speedTags[issueKey]}
                      onChange={(sp) => setSpeed(issueKey, sp)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
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
            {primaryFocusOptions.length === 0 ? "Select other options first" : "None selected"}
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

function primaryFocusSelectValue(ui: HandlingAssessmentUiState): string {
  if (!ui.primaryFocus) return "";
  const id = JSON.stringify(ui.primaryFocus);
  const opts = buildPrimaryFocusOptions(ui);
  return opts.some((o) => o.id === id) ? id : "";
}
