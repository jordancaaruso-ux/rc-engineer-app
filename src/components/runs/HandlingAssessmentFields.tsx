"use client";

import { useMemo, useState } from "react";
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
  "Understeer = the front washes out and the car won't turn in. Oversteer = the rear steps out and it rotates too much. The centre notch means it felt neutral there; leave a phase untouched if you'd rather not say.";

const CORNER_SPEEDS: CornerSpeed[] = ["slow", "fast", "both"];
const SPEED_SHORT: Record<CornerSpeed, string> = { slow: "Low speed", fast: "High speed", both: "Both" };
const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/**
 * Fill for one notch. Balance is a **deviation** axis, not a direction-of-preference one — the
 * capture model already treats any non-zero phase as a flagged issue (it's what unlocks the speed
 * tag), so both poles read in `destructive`, the app's "negative data" colour, and the intensity
 * ramps with magnitude so a slight lean stays quiet while a severe one shouts. Direction is
 * carried by which side of centre fills, plus the written readout — never by hue. (The earlier
 * purple/amber pairing collided with best-lap purple and validation amber elsewhere on this
 * screen.)
 */
const NOTCH_FILL: Record<1 | 2 | 3, string> = {
  1: "bg-destructive/35",
  2: "bg-destructive/60",
  3: "bg-destructive/90",
};

const NOTCH_EMPTY = "bg-secondary ring-1 ring-inset ring-border";

function notchFillClass(p: PhaseBalance, value: PhaseBalance | null): string {
  if (p === 0) return value === 0 ? "bg-muted-foreground/45" : NOTCH_EMPTY;
  if (value == null || value === 0) return NOTCH_EMPTY;
  const sameSide = (p < 0 && value < 0) || (p > 0 && value > 0);
  if (!sameSide || Math.abs(p) > Math.abs(value)) return NOTCH_EMPTY;
  return NOTCH_FILL[Math.abs(p) as 1 | 2 | 3];
}

function balanceValueText(value: PhaseBalance | null): string {
  if (value == null) return "—";
  if (value === 0) return "neutral";
  const word = HANDLING_SEVERITY_CHIP_LABELS[Math.abs(value) as 1 | 2 | 3];
  return `${word} ${value < 0 ? "understeer" : "oversteer"}`;
}

function notchLabel(p: PhaseBalance): string {
  if (p === 0) return "neutral";
  return `${HANDLING_SEVERITY_CHIP_LABELS[Math.abs(p) as 1 | 2 | 3]} ${
    p < 0 ? "understeer" : "oversteer"
  }`;
}

function patch(next: HandlingAssessmentUiState): HandlingAssessmentUiState {
  const clean = sanitizeHandlingUiState(next);
  // Below two flagged issues the main problem is implicit and never asked, so a focus left over
  // from a since-cleared flag would be a stored answer to a question that isn't on screen.
  if (clean.primaryFocus && buildPrimaryFocusOptions(clean).length < 2) {
    return { ...clean, primaryFocus: null };
  }
  return clean;
}

/**
 * One phase of the understeer ↔ oversteer axis: seven discrete notch buttons, −3…+3, keeping the
 * −21° skew as brand but as separated notches rather than a filled track (a track reads as the
 * wizard progress bar sitting at the bottom of the same screen). Tap-only by design: the panel
 * lives inside a swipeable `PagedCard`, which claims horizontal drags, so a handle-less drag
 * slider can never work here — and buttons can't be cleared by finger jitter mid-tap.
 */
function BalanceRow({
  label,
  current,
  onSelect,
}: {
  label: string;
  current: PhaseBalance | null;
  onSelect: (n: PhaseBalance) => void;
}) {
  const nudge = (delta: number) => {
    const idx = PHASE_BALANCE_LEVELS.indexOf(current ?? 0);
    const next = Math.min(PHASE_BALANCE_LEVELS.length - 1, Math.max(0, idx + delta));
    onSelect(PHASE_BALANCE_LEVELS[next]);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <span
          className={cn(
            "font-mono text-[10px] leading-none",
            current == null ? "text-muted-foreground/70" : "text-muted-foreground"
          )}
        >
          {balanceValueText(current)}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label={`${label} corner balance`}
        className="flex gap-[3px]"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            nudge(1);
            e.preventDefault();
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            nudge(-1);
            e.preventDefault();
          }
        }}
      >
        {PHASE_BALANCE_LEVELS.map((p) => {
          const selected = current === p;
          return (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={notchLabel(p)}
              tabIndex={selected || (current == null && p === 0) ? 0 : -1}
              onClick={() => onSelect(p)}
              className="group flex h-8 flex-1 items-center justify-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "h-4 w-full -skew-x-[21deg] rounded-[2px] transition-colors duration-150",
                  notchFillClass(p, current),
                  !selected && "group-hover:bg-destructive/20",
                  p === 0 && !selected && "group-hover:bg-muted-foreground/25"
                )}
              />
            </button>
          );
        })}
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

/** Small round "i" that toggles a one-off explanation. 24px so it's a real tap target. */
function InfoToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold leading-none transition",
        open
          ? "border-foreground/50 bg-muted text-foreground"
          : "border-muted-foreground/40 text-muted-foreground hover:border-foreground/50 hover:text-foreground"
      )}
    >
      i
    </button>
  );
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange: (next: HandlingAssessmentUiState) => void;
};

export function HandlingAssessmentFields({ value, onChange }: Props) {
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  /** Flag order, so a freshly tapped chip's detail row lands nearest the chip you just hit. */
  const [traitOrder, setTraitOrder] = useState<CaptureTraitAxisKey[]>(() =>
    CAPTURE_TRAIT_AXIS_KEYS.filter((axis) => {
      const v = value[axis];
      return v != null && v !== 0;
    })
  );
  const primaryFocusOptions = useMemo(() => buildPrimaryFocusOptions(value), [value]);
  const primaryFocusId = selectedPrimaryFocusId(value);

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
      setTraitOrder((order) => order.filter((a) => a !== axis));
      emit({ ...value, [axis]: null });
      return;
    }
    setTraitOrder((order) => (order.includes(axis) ? order : [...order, axis]));
    const severity = cur != null && cur !== 0 ? (Math.abs(cur) as 1 | 2 | 3) : 2;
    emit({ ...value, [axis]: (sign * severity) as PhaseBalance });
  }

  function setTraitSeverity(axis: CaptureTraitAxisKey, severity: 1 | 2 | 3) {
    const cur = value[axis];
    if (cur == null || cur === 0) return;
    const sign = Math.sign(cur);
    emit({ ...value, [axis]: (sign * severity) as PhaseBalance });
  }

  const flaggedTraitAxes = CAPTURE_TRAIT_AXIS_KEYS.filter((axis) => {
    const v = value[axis];
    return v != null && v !== 0;
  });
  // Tap order first, then anything flagged outside this component (loading a saved run).
  const activeTraitAxes = [
    ...traitOrder.filter((axis) => flaggedTraitAxes.includes(axis)),
    ...flaggedTraitAxes.filter((axis) => !traitOrder.includes(axis)),
  ];

  /* Primary focus only earns its place once there's a genuine choice to make — with 0–1 flagged
     issues the main problem is implicit (HANDLING_CAPTURE_NORTH_STAR). */
  const showPrimaryFocus = primaryFocusOptions.length >= 2;

  return (
    <div className="space-y-4 inset-panel p-3">
      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Corner balance</span>
          <InfoToggle
            label="What does corner balance mean?"
            open={balanceInfoOpen}
            onToggle={() => setBalanceInfoOpen((v) => !v)}
          />
        </div>
        {balanceInfoOpen ? (
          <p className="text-[10px] leading-snug text-muted-foreground">{PHASE_BALANCE_INFO}</p>
        ) : null}

        {/* One legend for all three phases — they share a single scale. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center text-[10px] font-medium text-muted-foreground">
          <span className="text-left">Understeer ◀</span>
          <span className="text-center font-mono text-[10px] font-normal text-muted-foreground/70">
            neutral
          </span>
          <span className="text-right">▶ Oversteer</span>
        </div>

        <div className="space-y-2.5">
          {PHASE_ROWS.map(({ stateKey, phase, label }) => {
            const rowVal = value[stateKey];
            const flagged = rowVal != null && rowVal !== 0;
            const issueKey = `balance:${phase}` as HandlingIssueKey;
            return (
              <div key={stateKey}>
                <BalanceRow
                  label={label}
                  current={rowVal}
                  onSelect={(n) => setPhaseBalance(stateKey, n)}
                />
                {flagged ? (
                  <div className="mt-1.5">
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
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Anything notable? (tap only if it was a problem)
        </div>
        {/* Grouped by axis: the two steering poles are one axis with two ends, so they sit as a
            joined pair rather than two chips that mysteriously cancel each other out. */}
        <div className="flex flex-wrap gap-1.5">
          {CAPTURE_TRAIT_AXIS_KEYS.map((axis) => {
            const poles = HANDLING_TRAIT_CHIP_META[axis].problemPoles;
            const paired = poles.length > 1;
            return (
              <div
                key={axis}
                className={cn("flex", paired && "gap-px")}
                role={paired ? "group" : undefined}
                aria-label={paired ? HANDLING_TRAIT_CHIP_META[axis].title : undefined}
              >
                {poles.map((pole, i) => {
                  const cur = value[axis];
                  const active = cur != null && cur !== 0 && Math.sign(cur) === pole.sign;
                  return (
                    <button
                      key={pole.sign}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleTraitChip(axis, pole.sign)}
                      className={cn(
                        chipToggleClass(active, { tone: "problem" }),
                        "px-2.5 py-1 text-[11px]",
                        !active && "hover:border-destructive/40",
                        paired && i === 0 && "rounded-r-none",
                        paired && i === poles.length - 1 && "rounded-l-none"
                      )}
                    >
                      {pole.label}
                    </button>
                  );
                })}
              </div>
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
                <div key={axis} className="space-y-2 rounded-md border border-border/60 bg-secondary/40 p-2">
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

      {showPrimaryFocus ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Which one mattered most?
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Primary focus">
            {primaryFocusOptions.map((o) => {
              const selected = primaryFocusId === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => emit({ ...value, primaryFocus: selected ? null : o.focus })}
                  className={cn(chipToggleClass(selected), "px-2.5 py-1 text-[11px]")}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function selectedPrimaryFocusId(ui: HandlingAssessmentUiState): string {
  if (!ui.primaryFocus) return "";
  const id = JSON.stringify(ui.primaryFocus);
  const opts = buildPrimaryFocusOptions(ui);
  return opts.some((o) => o.id === id) ? id : "";
}
