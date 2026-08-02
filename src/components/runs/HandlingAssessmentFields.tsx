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

type PhaseRow = (typeof PHASE_ROWS)[number];

const PHASE_BALANCE_LEVELS: PhaseBalance[] = [-3, -2, -1, 0, 1, 2, 3];

const PHASE_BALANCE_INFO =
  "Understeer = the front washes out and the car won't turn in. Oversteer = the rear steps out and it rotates too much. The centre notch means it felt neutral there; leave a phase untouched if you'd rather not say.";

const CORNER_SPEEDS: CornerSpeed[] = ["slow", "fast", "both"];
const SPEED_SHORT: Record<CornerSpeed, string> = { slow: "Low speed", fast: "High speed", both: "Both" };
/** Tile-width labels — the full phrase is carried by aria-label. */
const SPEED_TINY: Record<CornerSpeed, string> = { slow: "Low", fast: "High", both: "Both" };
const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/**
 * Balance is a **deviation** axis, not a direction-of-preference one — the capture model
 * already treats any non-zero phase as a flagged issue (it's what unlocks the speed tag),
 * so both poles read in `destructive`, the app's "negative data" colour, and the intensity
 * ramps with magnitude. Direction is carried by which side of centre the mark sits on plus
 * the written readout — never by hue. (Purple/amber collided with best-lap purple and
 * validation amber elsewhere on this screen.)
 */
function markStyle(v: PhaseBalance): { background: string; color: string } {
  if (v === 0) {
    return {
      background: "rgb(var(--color-muted-foreground) / 0.32)",
      color: "rgb(var(--color-foreground))",
    };
  }
  const magnitude = Math.abs(v);
  const alpha = magnitude === 1 ? 0.45 : magnitude === 2 ? 0.72 : 1;
  return {
    background: `rgb(var(--color-destructive) / ${alpha})`,
    // The two strong fills are dark enough that ink-on-fill loses contrast.
    color: magnitude >= 2 ? "rgb(var(--color-background))" : "rgb(var(--color-foreground))",
  };
}

function balanceValueText(value: PhaseBalance | null): string {
  if (value == null) return "—";
  if (value === 0) return "neutral";
  const word = HANDLING_SEVERITY_CHIP_LABELS[Math.abs(value) as 1 | 2 | 3];
  return `${word} ${value < 0 ? "understeer" : "oversteer"}`;
}

/** Compact state for the phase bar, where the full phrase won't fit. */
function balanceShortText(value: PhaseBalance | null): string {
  if (value == null) return "not set";
  if (value === 0) return "neutral";
  return `${value < 0 ? "US" : "OS"} ${Math.abs(value)}`;
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

/* ── Corner balance ────────────────────────────────────────────────────────────
   Geometry for the shared axis. Three named marks ride one −3…+3 track, each
   locked to its own vertical slot: an even three-way split would put the middle
   mark straight through the axis line and its tick marks, so two sit above and
   one below. Slots are fixed rather than computed so two phases on the same
   value can never stack on top of each other — the failure the earlier
   three-identical-dots version had.
   ──────────────────────────────────────────────────────────────────────────── */
const AXIS_H = 86;
const AXIS_Y = 43;
const MARK_H = 17;
const MARK_SLOT: Record<PhaseRow["phase"], number> = { entry: 2, mid: 21, exit: 58 };

/** Stop centres, as a percentage of the (padded) track width. */
function stopLeft(p: PhaseBalance): string {
  return `${((PHASE_BALANCE_LEVELS.indexOf(p) + 0.5) / PHASE_BALANCE_LEVELS.length) * 100}%`;
}

/** Leader runs from the mark's near edge to the axis — never through it. */
function leaderBox(slot: number): { top: number; height: number } {
  const bottom = slot + MARK_H;
  return bottom <= AXIS_Y
    ? { top: bottom, height: AXIS_Y - bottom }
    : { top: AXIS_Y, height: slot - AXIS_Y };
}

/**
 * Entry / mid / exit on a single understeer ↔ oversteer axis.
 *
 * Rebuilt 2026-08-02 (founder review, three rounds of live A/B). What changed and why:
 * - **One axis, not three rows of seven notches.** Twenty-one targets to say one thing
 *   about a corner; now seven, and the three marks on one scale make the shape of the
 *   corner readable at a glance.
 * - **Each mark is named.** The previous pass distinguished the phases only by fill
 *   opacity, which was already carrying severity — one channel doing two jobs, and it
 *   could only do one. The label carries the phase; the fill is free to mean severity.
 * - **The −21° skew is gone.** Skewed chips at this size read as noise rather than brand.
 *
 * Tap-only by design: the panel lives inside a swipeable `PagedCard`, which claims
 * horizontal drags, so a drag slider can never work here — and buttons can't be cleared
 * by finger jitter mid-tap.
 */
function BalanceAxis({
  values,
  live,
  onLive,
  onSelect,
}: {
  values: Record<PhaseRow["phase"], PhaseBalance | null>;
  live: PhaseRow["phase"];
  onLive: (phase: PhaseRow["phase"]) => void;
  onSelect: (phase: PhaseRow["phase"], n: PhaseBalance) => void;
}) {
  const liveRow = PHASE_ROWS.find((r) => r.phase === live) ?? PHASE_ROWS[0];
  const liveValue = values[live];

  const nudge = (delta: number) => {
    const idx = PHASE_BALANCE_LEVELS.indexOf(liveValue ?? 0);
    const next = Math.min(PHASE_BALANCE_LEVELS.length - 1, Math.max(0, idx + delta));
    onSelect(live, PHASE_BALANCE_LEVELS[next]);
  };

  return (
    <div className="space-y-2">
      {/* Which phase the next tap lands on, plus a read of all three at once. */}
      <div className="flex gap-[3px]" role="group" aria-label="Corner phase">
        {PHASE_ROWS.map((row) => {
          const isLive = row.phase === live;
          return (
            <button
              key={row.phase}
              type="button"
              aria-pressed={isLive}
              onClick={() => onLive(row.phase)}
              className={cn(
                "flex-1 rounded-md px-1 pb-1.5 pt-1.5 text-center font-sans text-[11px] font-semibold tracking-tight",
                "ring-1 ring-inset transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isLive
                  ? "bg-muted text-foreground ring-foreground/40"
                  : "bg-secondary text-muted-foreground ring-border hover:text-foreground"
              )}
            >
              {row.label}
              <span
                className={cn(
                  "mt-px block font-sans text-[9.5px] font-medium",
                  isLive ? "text-muted-foreground" : "text-faint"
                )}
              >
                {balanceShortText(values[row.phase])}
              </span>
            </button>
          );
        })}
      </div>

      {/* One legend for all three phases — they share a single scale. One voice
          throughout: the centre word used to be mono among sans. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center px-3 font-sans text-[10.5px] font-medium text-muted-foreground">
        <span className="text-left">Understeer</span>
        <span className="text-center text-faint">neutral</span>
        <span className="text-right">Oversteer</span>
      </div>

      <div className="relative px-3" style={{ height: AXIS_H }}>
        <div className="absolute inset-x-3 top-1/2 h-px bg-border" />
        <div className="absolute left-1/2 w-px -translate-x-1/2 bg-muted-foreground/30" style={{ top: 26, bottom: 26 }} />

        <div
          role="radiogroup"
          aria-label={`${liveRow.label} corner balance`}
          className="absolute inset-x-3 top-1/2 flex h-0"
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
            const selected = liveValue === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${liveRow.label} — ${notchLabel(p)}`}
                tabIndex={selected || (liveValue == null && p === 0) ? 0 : -1}
                onClick={() => onSelect(live, p)}
                className="group -mt-[13px] grid h-[26px] flex-1 place-items-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block h-[7px] w-[2px] rounded-[1px] bg-border transition-colors duration-150 group-hover:bg-faint" />
              </button>
            );
          })}
        </div>

        {/* Marks + leaders. Percentages are taken against the same padded box as
            the stops, so a mark always sits dead on its notch. */}
        <div className="pointer-events-none absolute inset-x-3 inset-y-0">
          {PHASE_ROWS.map((row) => {
            const v = values[row.phase];
            if (v == null) return null;
            const slot = MARK_SLOT[row.phase];
            const leader = leaderBox(slot);
            const style = markStyle(v);
            return (
              <div key={row.phase}>
                <div
                  className="absolute w-px bg-muted-foreground/30"
                  style={{ left: stopLeft(v), top: leader.top, height: leader.height }}
                />
                <div
                  className="absolute -translate-x-1/2 rounded-full px-2 py-[3px] font-sans text-[9.5px] font-bold uppercase leading-none tracking-[0.04em] transition-[left] duration-200"
                  style={{ left: stopLeft(v), top: slot, ...style }}
                >
                  {row.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="ui-caption">
        Tap a phase, then place it — it steps on by itself. Leave one untouched if you&apos;d rather not
        say.
      </p>
    </div>
  );
}

/** Slow / Fast / Both selector for a flagged issue. Tap the active one to clear. */
function SpeedTagPicker({
  value,
  onChange,
  label = "Which corners?",
  groupLabel = "Which corners",
}: {
  value: CornerSpeed | undefined;
  onChange: (next: CornerSpeed | null) => void;
  label?: string | null;
  groupLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {label ? <span className="text-[10px] text-muted-foreground">{label}</span> : null}
      <div className="flex gap-1" role="group" aria-label={groupLabel}>
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

/**
 * One notable, as a tile. Flag and severity are the same gesture: tap to raise it
 * mild → moderate → severe, once more to clear. That replaces the old chip-then-hunt-
 * for-the-severity-card two-step, which was the actual complaint about the chip wall —
 * nothing appears or disappears below you as you answer.
 */
function NotableTile({
  label,
  severity,
  speed,
  onCycle,
  onSpeed,
}: {
  label: string;
  severity: 1 | 2 | 3 | null;
  speed: CornerSpeed | undefined;
  onCycle: () => void;
  onSpeed: (next: CornerSpeed | null) => void;
}) {
  const active = severity != null;
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2.5 transition-colors duration-150",
        active ? "border-destructive/60 bg-destructive/10" : "border-border bg-secondary"
      )}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-label={
          active
            ? `${label} — ${HANDLING_SEVERITY_CHIP_LABELS[severity]}. Tap to raise or clear.`
            : `${label} — not flagged. Tap to flag.`
        }
        onClick={onCycle}
        className="flex w-full flex-col gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "font-sans text-[11.5px] font-semibold leading-tight tracking-tight",
            active ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        <span aria-hidden className="flex gap-[3px]">
          {SEVERITIES.map((s) => (
            <span
              key={s}
              className={cn(
                "h-[3px] w-full rounded-sm transition-colors duration-150",
                severity != null && s <= severity ? "bg-destructive" : "bg-muted"
              )}
            />
          ))}
        </span>
      </button>

      {/* The corner-speed tag lives inside the tile it belongs to, so flagging one
          notable never reflows the ones below it. */}
      {active ? (
        <div className="flex gap-[3px]" role="group" aria-label={`${label} — which corners`}>
          {CORNER_SPEEDS.map((s) => {
            const selected = speed === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={selected}
                aria-label={SPEED_SHORT[s]}
                onClick={() => onSpeed(selected ? null : s)}
                className={cn(chipToggleClass(selected), "flex-1 px-1 py-0.5 text-[10px]")}
              >
                {SPEED_TINY[s]}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange: (next: HandlingAssessmentUiState) => void;
};

/** Each problem pole gets its own tile; poles on one axis stay mutually exclusive. */
const NOTABLE_TILES: { axis: CaptureTraitAxisKey; sign: -1 | 1; label: string }[] =
  CAPTURE_TRAIT_AXIS_KEYS.flatMap((axis) =>
    HANDLING_TRAIT_CHIP_META[axis].problemPoles.map((pole) => ({
      axis,
      sign: pole.sign,
      label: pole.label,
    }))
  );

export function HandlingAssessmentFields({ value, onChange }: Props) {
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  const [livePhase, setLivePhase] = useState<PhaseRow["phase"]>("entry");
  const primaryFocusOptions = useMemo(() => buildPrimaryFocusOptions(value), [value]);
  const primaryFocusId = selectedPrimaryFocusId(value);

  function emit(next: HandlingAssessmentUiState) {
    onChange(patch(next));
  }

  const balanceValues: Record<PhaseRow["phase"], PhaseBalance | null> = {
    entry: value.balanceEntry,
    mid: value.balanceMid,
    exit: value.balanceExit,
  };

  function setPhaseBalance(phase: PhaseRow["phase"], n: PhaseBalance) {
    const row = PHASE_ROWS.find((r) => r.phase === phase);
    if (!row) return;
    const cur = value[row.stateKey];
    const cleared = cur === n;
    emit({ ...value, [row.stateKey]: cleared ? null : n });
    // Placing a phase steps to the next one; clearing leaves you where you are.
    if (!cleared) {
      const idx = PHASE_ROWS.findIndex((r) => r.phase === phase);
      if (idx < PHASE_ROWS.length - 1) setLivePhase(PHASE_ROWS[idx + 1].phase);
    }
  }

  function setSpeed(issueKey: HandlingIssueKey, speed: CornerSpeed | null) {
    const nextTags = { ...value.speedTags };
    if (speed == null) delete nextTags[issueKey];
    else nextTags[issueKey] = speed;
    emit({ ...value, speedTags: nextTags });
  }

  /**
   * Tap-up cycle for a notable: off → mild → moderate → severe → off. Tapping the
   * opposite pole of a bipolar axis switches sides and restarts at mild, which keeps
   * the two poles mutually exclusive without a separate clear.
   */
  function cycleNotable(axis: CaptureTraitAxisKey, sign: -1 | 1) {
    const cur = value[axis];
    const active = cur != null && cur !== 0 && Math.sign(cur) === sign;
    if (!active) {
      emit({ ...value, [axis]: sign as PhaseBalance });
      return;
    }
    const severity = Math.abs(cur as number) as 1 | 2 | 3;
    if (severity < 3) {
      emit({ ...value, [axis]: (sign * (severity + 1)) as PhaseBalance });
      return;
    }
    emit({ ...value, [axis]: null });
  }

  const flaggedPhases = PHASE_ROWS.filter((row) => {
    const v = value[row.stateKey];
    return v != null && v !== 0;
  });

  /* Primary focus only earns its place once there's a genuine choice to make — with 0–1 flagged
     issues the main problem is implicit (HANDLING_CAPTURE_NORTH_STAR). */
  const showPrimaryFocus = primaryFocusOptions.length >= 2;

  return (
    <div className="space-y-4 inset-panel p-3">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Corner balance</span>
          <button
            type="button"
            aria-expanded={balanceInfoOpen}
            onClick={() => setBalanceInfoOpen((v) => !v)}
            className="font-sans text-[11px] text-faint underline decoration-border underline-offset-[3px] transition-colors hover:text-muted-foreground"
          >
            What&apos;s this?
          </button>
        </div>
        {balanceInfoOpen ? (
          <p className="text-[10px] leading-snug text-muted-foreground">{PHASE_BALANCE_INFO}</p>
        ) : null}

        <BalanceAxis
          values={balanceValues}
          live={livePhase}
          onLive={setLivePhase}
          onSelect={setPhaseBalance}
        />

        {flaggedPhases.length > 0 ? (
          <div className="space-y-1.5 pt-0.5">
            {flaggedPhases.map((row) => {
              const issueKey = `balance:${row.phase}` as HandlingIssueKey;
              return (
                <div key={row.phase} className="flex items-center gap-2">
                  <span className="w-9 shrink-0 font-sans text-[10px] font-semibold text-foreground">
                    {row.label}
                  </span>
                  <SpeedTagPicker
                    value={value.speedTags[issueKey]}
                    onChange={(s) => setSpeed(issueKey, s)}
                    label={null}
                    groupLabel={`${row.label} — which corners`}
                  />
                  <span className="ml-auto font-sans text-[10px] text-muted-foreground">
                    {balanceValueText(value[row.stateKey])}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">
          Anything notable? Only what was a problem.
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {NOTABLE_TILES.map((tile) => {
            const cur = value[tile.axis];
            const active = cur != null && cur !== 0 && Math.sign(cur) === tile.sign;
            const severity = active ? (Math.abs(cur as number) as 1 | 2 | 3) : null;
            const issueKey = `trait:${tile.axis}` as HandlingIssueKey;
            return (
              <NotableTile
                key={`${tile.axis}:${tile.sign}`}
                label={tile.label}
                severity={severity}
                speed={value.speedTags[issueKey]}
                onCycle={() => cycleNotable(tile.axis, tile.sign)}
                onSpeed={(s) => setSpeed(issueKey, s)}
              />
            );
          })}
        </div>
        <p className="ui-caption">
          Tap to flag. Tap again for worse — mild, moderate, severe, then off.
        </p>
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
