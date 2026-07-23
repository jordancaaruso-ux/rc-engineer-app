"use client";

import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
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
const SPEED_SHORT: Record<CornerSpeed, string> = { slow: "Low speed", fast: "High speed", both: "Both" };
const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/** Flat list of problem chips: bipolar traits (steering feel) contribute two. */
const CHIP_DEFS: Array<{ axis: CaptureTraitAxisKey; sign: -1 | 1; label: string }> =
  CAPTURE_TRAIT_AXIS_KEYS.flatMap((axis) =>
    HANDLING_TRAIT_CHIP_META[axis].problemPoles.map((p) => ({ axis, sign: p.sign, label: p.label }))
  );

function patch(next: HandlingAssessmentUiState): HandlingAssessmentUiState {
  return sanitizeHandlingUiState(next);
}

// purple-500 / amber-500 as raw triplets so fill opacity can ramp toward the set notch.
const US_RGB = "168, 85, 247"; // understeer, purple-500
const OS_RGB = "245, 158, 11"; // oversteer, amber-500
const SEG_OFF = "#232120"; // unfilled segment (matches LogRunWizardBottomBar track)

/**
 * Diverging fill for one angled segment at step `p`, given the selected `value`.
 * This is a balance axis, not a quality axis — the two poles are directions, not good/bad, so it
 * deliberately avoids the red/green pace-and-quality convention. The fill runs out of the neutral
 * centre toward the set notch and brightens to its strongest there, so the value reads without a
 * handle. Amber (not the reserved electric-yellow action colour) marks the oversteer end.
 */
function segmentFill(p: PhaseBalance, value: PhaseBalance | null): string {
  if (value == null) return SEG_OFF;
  if (p === 0) return value === 0 ? "rgba(160, 157, 150, 0.5)" : SEG_OFF; // grey centre only when neutral is chosen
  const sameSide = (p < 0 && value < 0) || (p > 0 && value > 0);
  if (!sameSide || Math.abs(p) > Math.abs(value)) return SEG_OFF;
  const opacity = 0.5 + 0.5 * (Math.abs(p) / Math.abs(value)); // brightest at the tip
  return `rgba(${p < 0 ? US_RGB : OS_RGB}, ${opacity})`;
}

function balanceValueText(value: PhaseBalance | null): string {
  if (value == null || value === 0) return "neutral";
  const word = HANDLING_SEVERITY_CHIP_LABELS[Math.abs(value) as 1 | 2 | 3];
  return `${word} ${value < 0 ? "understeer" : "oversteer"}`;
}

/**
 * Understeer ↔ oversteer balance, −3…+3, as a detented bar of angled (−21°) segments — the same
 * skew treatment as the Log Run wizard progress bar (LogRunWizardBottomBar). No handle: the fill
 * runs out of the neutral centre and brightens to the set notch. Tap a notch or drag across.
 */
function BalanceScale({
  title,
  info,
  current,
  onSelect,
}: {
  title: string;
  info: string;
  current: PhaseBalance | null;
  onSelect: (n: PhaseBalance) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pickFromClientX = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.round(frac * (PHASE_BALANCE_LEVELS.length - 1));
    onSelect(PHASE_BALANCE_LEVELS[idx]);
  };

  const nudge = (delta: number) => {
    const idx = PHASE_BALANCE_LEVELS.indexOf(current ?? 0);
    const next = Math.min(PHASE_BALANCE_LEVELS.length - 1, Math.max(0, idx + delta));
    onSelect(PHASE_BALANCE_LEVELS[next]);
  };

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

      <div
        ref={barRef}
        role="slider"
        tabIndex={0}
        aria-label={title}
        aria-valuemin={-3}
        aria-valuemax={3}
        aria-valuenow={current ?? 0}
        aria-valuetext={balanceValueText(current)}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          pickFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) pickFromClientX(e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            nudge(1);
            e.preventDefault();
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            nudge(-1);
            e.preventDefault();
          }
        }}
        className="relative h-7 cursor-pointer touch-none rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="absolute inset-x-0 top-1/2 h-[14px] -translate-y-1/2 overflow-hidden rounded-[3px] bg-[#141310] shadow-[inset_0_0_0_1px_#34322f]">
          <div className="absolute -inset-x-[6px] inset-y-0 flex gap-[3px]" aria-hidden>
            {PHASE_BALANCE_LEVELS.map((p) => (
              <span
                key={p}
                className="flex-1 -skew-x-[21deg] transition-colors duration-150"
                style={{ background: segmentFill(p, current) }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center text-[10px] font-medium">
        <span className="text-left text-purple-700/90 dark:text-purple-400/90">◀ Understeer</span>
        <span className="text-center text-[9px] font-normal text-muted-foreground">neutral</span>
        <span className="text-right text-amber-700/90 dark:text-amber-400/90">Oversteer ▶</span>
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
      <span className="text-[10px] text-muted-foreground">Which corners?</span>
      <div className="flex gap-1" role="group" aria-label="Which corners">
        {CORNER_SPEEDS.map((s) => {
          const selected = value === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? null : s)}
              className={cn(chipToggleClass(selected), "px-2 py-0.5 text-[10px]")}
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
              <BalanceScale
                title={label}
                info={PHASE_BALANCE_INFO}
                current={rowVal}
                onSelect={(n) => setPhaseBalance(stateKey, n)}
              />
              {flagged ? (
                <div className="mt-2 pl-0.5">
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
                  chipToggleClass(active, { tone: "problem" }),
                  "px-2.5 py-1 text-[11px]",
                  !active && "hover:border-destructive/40"
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
                              chipToggleClass(selected),
                              "px-2 py-0.5 text-[10px] capitalize"
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
