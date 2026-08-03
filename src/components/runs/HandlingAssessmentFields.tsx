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
const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/**
 * Rising step heights for a notable's severity mark. The staircase is the whole
 * point: the silhouette has to read "worse" before the word does, so the blocks
 * grow left→right and the unlit ones stay visible as a ghost — you can see there
 * is more to give before you give it.
 */
const SEVERITY_STEP_H: Record<1 | 2 | 3, number> = { 1: 3, 2: 6, 3: 10 };

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

/** Lane readout — 30px of column, so the phrase contracts to a code. */
function balanceCode(value: PhaseBalance | null): string {
  if (value == null) return "—";
  if (value === 0) return "0";
  return `${value < 0 ? "US" : "OS"}${Math.abs(value)}`;
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
   One lane per phase, all three on the same −3…+3 grid. `LANE_COLS` is shared by
   the legend so "Understeer / neutral / Oversteer" sits over the track column and
   nothing else.
   ──────────────────────────────────────────────────────────────────────────── */
const LANE_COLS = "grid-cols-[34px_1fr_30px]";

/** Stop centres, as a percentage of the track width. */
function stopLeft(p: PhaseBalance): string {
  return `${((PHASE_BALANCE_LEVELS.indexOf(p) + 0.5) / PHASE_BALANCE_LEVELS.length) * 100}%`;
}

/** Mark diameter grows with magnitude, so size seconds what the fill already says. */
function markSize(v: PhaseBalance): number {
  return v === 0 ? 13 : 12 + Math.abs(v) * 2.5;
}

/**
 * One phase on its own −3…+3 track: label · track · readout.
 *
 * Every stop is directly tappable, which is the whole reason the lane exists —
 * the previous pass shared a single line between all three phases, so a tap only
 * meant something after you had told it which phase you were talking about. Three
 * lanes cost nothing in height and delete that step. They also make collisions
 * impossible: two phases on the same value can't stack, because they were never
 * on the same line.
 *
 * Tap-only by design: the panel lives inside a swipeable `PagedCard`, which claims
 * horizontal drags, so a drag slider can never work here — and buttons can't be
 * cleared by finger jitter mid-tap.
 */
function BalanceLane({
  row,
  value,
  onSelect,
}: {
  row: PhaseRow;
  value: PhaseBalance | null;
  onSelect: (n: PhaseBalance) => void;
}) {
  const nudge = (delta: number) => {
    const idx = PHASE_BALANCE_LEVELS.indexOf(value ?? 0);
    const next = Math.min(PHASE_BALANCE_LEVELS.length - 1, Math.max(0, idx + delta));
    onSelect(PHASE_BALANCE_LEVELS[next]);
  };

  return (
    <div className={cn("grid h-[26px] items-center gap-2", LANE_COLS)}>
      <span className="font-sans text-[11px] font-semibold tracking-tight text-foreground">
        {row.label}
      </span>

      <div className="relative h-[26px]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
        <div className="absolute inset-y-[3px] left-1/2 w-px -translate-x-1/2 bg-muted-foreground/30" />

        <div
          role="radiogroup"
          aria-label={`${row.label} corner balance`}
          className="absolute inset-0 flex"
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
            const selected = value === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`${row.label} — ${notchLabel(p)}`}
                tabIndex={selected || (value == null && p === 0) ? 0 : -1}
                onClick={() => onSelect(p)}
                className="group grid flex-1 place-items-center rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="block h-[7px] w-[2px] rounded-[1px] bg-border transition-colors duration-150 group-hover:bg-faint" />
              </button>
            );
          })}
        </div>

        {value != null ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 rounded-full transition-[left,width,height] duration-200"
            style={{
              left: stopLeft(value),
              width: markSize(value),
              height: markSize(value),
              transform: "translate(-50%, -50%)",
              background: markStyle(value).background,
              boxShadow: "0 0 0 3px rgb(var(--color-background) / 0.85)",
            }}
          />
        ) : null}
      </div>

      <span
        className={cn(
          "text-right font-sans text-[10px] font-semibold tabular-nums tracking-tight",
          value == null ? "text-faint" : value === 0 ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {balanceCode(value)}
      </span>
    </div>
  );
}

/** Entry / mid / exit, one lane each, under a legend they all share. */
function BalanceLanes({
  values,
  onSelect,
}: {
  values: Record<PhaseRow["phase"], PhaseBalance | null>;
  onSelect: (phase: PhaseRow["phase"], n: PhaseBalance) => void;
}) {
  return (
    <div className="space-y-2">
      {/* One legend for all three lanes — they share a single scale. One voice
          throughout: the centre word used to be mono among sans. */}
      <div className={cn("grid gap-2", LANE_COLS)}>
        <span />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center font-sans text-[10.5px] font-medium text-muted-foreground">
          <span className="text-left">Understeer</span>
          <span className="text-center text-faint">neutral</span>
          <span className="text-right">Oversteer</span>
        </div>
        <span />
      </div>

      <div className="space-y-1.5">
        {PHASE_ROWS.map((row) => (
          <BalanceLane
            key={row.phase}
            row={row}
            value={values[row.phase]}
            onSelect={(n) => onSelect(row.phase, n)}
          />
        ))}
      </div>

      <p className="ui-caption">
        Place each phase on the line. Leave one untouched if you&apos;d rather not say.
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
    <div className="flex shrink-0 items-center gap-1.5">
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
              className={cn(chipToggleClass(selected), "whitespace-nowrap px-2 py-0.5 text-[10px]")}
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
 *
 * The corner-speed row is gone (founder call 2026-08-03): Low / High / Both was a
 * second question asked six times over, and on a trait it rarely changed the read —
 * "traction rolled" is "traction rolled". The three balance phases keep their speed
 * tag, which is where slow-vs-fast does change the diagnosis. Nothing is stripped
 * from runs that already carry a trait tag; capture just stops adding new ones.
 *
 * With speed gone the mark has to carry the escalation alone, so the blocks rise
 * left→right instead of sitting flat — the silhouette says "worse" before the word
 * does, and the unlit steps stay visible so the remaining headroom is legible.
 */
function NotableTile({
  label,
  severity,
  onCycle,
}: {
  label: string;
  severity: 1 | 2 | 3 | null;
  onCycle: () => void;
}) {
  const active = severity != null;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={
        active
          ? `${label} — ${HANDLING_SEVERITY_CHIP_LABELS[severity]}. Tap to raise or clear.`
          : `${label} — not flagged. Tap to flag.`
      }
      onClick={onCycle}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-2.5 text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-destructive/60 bg-destructive/10" : "border-border bg-secondary"
      )}
    >
      <span
        className={cn(
          "font-sans text-[11.5px] font-semibold leading-tight tracking-tight",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      <span aria-hidden className="mt-auto flex h-[10px] items-end gap-[3px]">
        {SEVERITIES.map((s) => (
          <span
            key={s}
            className={cn(
              "w-full rounded-[1.5px] transition-colors duration-150",
              severity != null && s <= severity ? "bg-destructive" : "bg-muted"
            )}
            style={{ height: SEVERITY_STEP_H[s] }}
          />
        ))}
      </span>
    </button>
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
    // Tapping the stop a phase already sits on clears it — the only way back to
    // "didn't say", which is a real answer here.
    emit({ ...value, [row.stateKey]: value[row.stateKey] === n ? null : n });
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

        <BalanceLanes values={balanceValues} onSelect={setPhaseBalance} />

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
                  {/* Truncates rather than squeezing the chips into a second line —
                      the lane readout two rows up already carries the value. */}
                  <span className="ml-auto min-w-0 truncate font-sans text-[10px] text-muted-foreground">
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
            return (
              <NotableTile
                key={`${tile.axis}:${tile.sign}`}
                label={tile.label}
                severity={severity}
                onCycle={() => cycleNotable(tile.axis, tile.sign)}
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
