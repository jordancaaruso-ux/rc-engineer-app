"use client";

import { Fragment, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { haptic } from "@/lib/haptics";
import {
  buildPrimaryFocusOptions,
  CAPTURE_TRAIT_AXIS_KEYS,
  HANDLING_SEVERITY_CHIP_LABELS,
  HANDLING_TRAIT_CHIP_META,
  sanitizeHandlingUiState,
  type CaptureTraitAxisKey,
  type HandlingAssessmentUiState,
  type PhaseBalance,
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

const PHASE_BALANCE_INFO =
  "Understeer = the front washes out and the car won't turn in. Oversteer = the rear steps out and it rotates too much. Tap a side to flag it, again for worse. The dot in the middle means it felt neutral there; leave a phase alone if you'd rather not say.";

const SEVERITIES: Array<1 | 2 | 3> = [1, 2, 3];

/**
 * Rising step heights for a notable's severity mark. The staircase is the whole
 * point: the silhouette has to read "worse" before the word does, so the blocks
 * grow left→right and the unlit ones stay visible as a ghost — you can see there
 * is more to give before you give it.
 */
const SEVERITY_STEP_H: Record<1 | 2 | 3, number> = { 1: 3, 2: 6, 3: 10 };

/**
 * Balance tile heights (px) for |1| / |2| / |3|. Taller than the notable staircase
 * because the balance rows are 44px — at the notable's 3/6/10 the silhouette gets
 * lost in the extra height, which is the whole thing the tiles are there to carry.
 */
const BALANCE_TILE_H: Record<1 | 2 | 3, number> = { 1: 5, 2: 9, 3: 14 };

/**
 * Filling springs, draining doesn't. `PrepSlider`'s curve is reused deliberately —
 * anything in this app that fills should fill the same way — while clearing gets a
 * plain deceleration, so building an answer up feels earned and taking it away
 * feels like nothing.
 */
const FILL_SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";
const DRAIN_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Balance is a **deviation** axis, not a direction-of-preference one — direction is
 * carried by which side of the centre the tiles light on, never by hue, and magnitude
 * by how far the staircase has climbed.
 *
 * Capture uses the **accent** (founder 2026-08-03, superseding the destructive-coral
 * treatment and VISUAL_NORTH_STAR's "yellow = action only"): balance is now asked on
 * every run, so most answers describe what the car did rather than report a fault, and
 * coral read as "something is wrong" on ordinary data. Read-back drops to a monochrome
 * ink ramp so a stored record can never be mistaken for a live control.
 */
function tileFill(level: 1 | 2 | 3, readOnly: boolean): string {
  if (readOnly) {
    const grey = level === 1 ? 0.22 : level === 2 ? 0.4 : 0.62;
    return `rgb(var(--color-foreground) / ${grey})`;
  }
  const alpha = level === 1 ? 0.42 : level === 2 ? 0.7 : 1;
  return `rgb(var(--color-accent) / ${alpha})`;
}

function balanceValueText(value: PhaseBalance | null): string {
  if (value == null) return "not answered";
  if (value === 0) return "neutral";
  const word = HANDLING_SEVERITY_CHIP_LABELS[Math.abs(value) as 1 | 2 | 3];
  return `${word} ${value < 0 ? "understeer" : "oversteer"}`;
}

/** Magnitude currently showing on one side of a phase; 0 when that side isn't flagged. */
function sideMagnitude(value: PhaseBalance | null, sign: -1 | 1): 0 | 1 | 2 | 3 {
  if (value == null || value === 0) return 0;
  return Math.sign(value) === sign ? (Math.abs(value) as 1 | 2 | 3) : 0;
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
   One instrument per phase: [ understeer | · | oversteer ], sealed into a single
   hairline-seamed object so a row reads as one question with a middle rather than
   two loose chips. `BALANCE_COLS` is shared by the header so "Understeer" and
   "Oversteer" are said once, over the column they name, instead of six times down
   the card. The label column is 48px because "Entry" overruns anything narrower
   and lands under the tiles.
   ──────────────────────────────────────────────────────────────────────────── */
const BALANCE_COLS = "grid-cols-[48px_1fr_30px_1fr]";

/**
 * One pole of one phase: a severity word over three tiles that climb toward the
 * outside edge, so the pair of zones opens away from the centre and the silhouette
 * says which way the car went before any word does.
 *
 * Flag and severity are the same gesture, exactly as the notable tiles do it — tap
 * to flag, tap again for worse, once more to clear. At severe the press dims the
 * tiles first: the fourth tap destroys the answer, so it is previewed rather than
 * sprung.
 *
 * Tap-only by design: the panel lives inside a swipeable `PagedCard`, which claims
 * horizontal drags, so a drag control can never work here.
 */
function BalanceZone({
  phaseLabel,
  sign,
  value,
  onPress,
  readOnly = false,
}: {
  phaseLabel: string;
  sign: -1 | 1;
  value: PhaseBalance | null;
  onPress: () => void;
  readOnly?: boolean;
}) {
  const magnitude = sideMagnitude(value, sign);
  const active = magnitude > 0;
  // Understeer draws 3→1 left to right, oversteer 1→3, so the tall tile always
  // lands on the outer edge and the lit run grows out of the centre seam.
  const levels: Array<1 | 2 | 3> = sign < 0 ? [3, 2, 1] : [1, 2, 3];

  /* The zone surface never changes with state. An accent wash goes olive over this
     ground and fights the tiles in front of it; lifting to `bg-muted` instead makes
     the *unlit* tiles vanish, because that is exactly their colour — and losing the
     ghost staircase costs the "there is more to give" reading the tiles exist for.
     Lit tiles plus the severity word carry the state on their own. */
  const shell = cn(
    "group flex min-h-[44px] items-center bg-secondary px-2.5 py-[7px] text-left transition-colors duration-150",
    !readOnly &&
      "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
  );

  const body = (
    <span className="grid w-full gap-1 transition-transform duration-100 group-active:scale-[0.975] motion-reduce:transition-none">
      {/* The word keeps a reserved line whether or not it is showing, so nothing
          shifts under the thumb when a phase is first flagged. It hugs the seam on
          both sides — the two words end up next to each other, which is where the
          eye lands scanning three rows. */}
      <span className={cn("flex h-3 items-center", sign < 0 ? "justify-end" : "justify-start")}>
        {active ? (
          <span className="font-sans text-[10px] font-semibold tracking-tight text-foreground">
            {HANDLING_SEVERITY_CHIP_LABELS[magnitude as 1 | 2 | 3]}
          </span>
        ) : null}
      </span>
      <span aria-hidden className="flex h-3.5 items-end gap-[3px]">
        {levels.map((level) => {
          const lit = level <= magnitude;
          return (
            <span
              key={level}
              className={cn(
                "block flex-1 rounded-[2px] bg-muted transition-[background-color,opacity] motion-reduce:transition-none",
                magnitude === 3 && !readOnly && "group-active:opacity-30"
              )}
              style={{
                height: BALANCE_TILE_H[level],
                /* A CSS transition uses the timing declared on the state it is moving
                   *to*, so lighting up springs outward from the seam and clearing
                   drains back inward — no need to track the previous value. */
                transitionDuration: lit ? "190ms" : "130ms",
                transitionTimingFunction: lit ? FILL_SPRING : DRAIN_EASE,
                transitionDelay: `${lit ? (level - 1) * 26 : (3 - level) * 22}ms`,
                ...(lit ? { background: tileFill(level, readOnly) } : null),
              }}
            />
          );
        })}
      </span>
    </span>
  );

  const poleWord = sign < 0 ? "understeer" : "oversteer";

  if (readOnly) {
    // The tiles are aria-hidden, so the reading has to reach a screen reader in text.
    return (
      <div className={shell}>
        <span className="sr-only">
          {phaseLabel} — {active ? balanceValueText(value) : `not flagged, ${poleWord}`}
        </span>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      aria-label={
        active
          ? `${phaseLabel} — ${balanceValueText(value)}. Tap to raise or clear.`
          : `${phaseLabel} — not flagged, ${poleWord}. Tap to flag.`
      }
      onClick={onPress}
      className={shell}
    >
      {body}
    </button>
  );
}

/**
 * The middle of the axis. Two poles alone can't say "I checked, it was fine" — and
 * balance is asked on every run, so that answer comes up constantly. `0` is a value
 * the data model already stores and the Engineer already reads; without somewhere to
 * put it, neutral would silently collapse into "didn't say", which is a different
 * answer entirely.
 */
function BalanceNeutral({
  phaseLabel,
  isNeutral,
  onPress,
  readOnly = false,
}: {
  phaseLabel: string;
  isNeutral: boolean;
  onPress: () => void;
  readOnly?: boolean;
}) {
  const shell = cn(
    "flex min-h-[44px] items-center justify-center bg-secondary",
    !readOnly &&
      "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
  );
  const pip = (
    <span
      aria-hidden
      className={cn(
        "block h-1.5 w-1.5 rounded-full transition-[transform,background-color] duration-200 motion-reduce:transition-none",
        isNeutral ? "scale-150 bg-muted-foreground/80" : "bg-border"
      )}
    />
  );

  if (readOnly) {
    return (
      <div className={shell}>
        <span className="sr-only">{isNeutral ? `${phaseLabel} — neutral` : ""}</span>
        {pip}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={isNeutral}
      aria-label={`${phaseLabel} — felt neutral. ${isNeutral ? "Tap to clear." : "Tap to mark neutral."}`}
      onClick={onPress}
      className={shell}
    >
      {pip}
    </button>
  );
}

/**
 * Entry / mid / exit, each its own sealed instrument, under a header they share.
 *
 * On read-back only the phases that were answered are drawn (founder 2026-08-03) —
 * an empty row in a stored record is not information, and the header keeps the scale
 * readable without it.
 */
function BalanceInstrument({
  values,
  onSet,
  readOnly = false,
}: {
  values: Record<PhaseRow["phase"], PhaseBalance | null>;
  onSet: (phase: PhaseRow["phase"], next: PhaseBalance | null) => void;
  readOnly?: boolean;
}) {
  const rows = readOnly ? PHASE_ROWS.filter((row) => values[row.phase] != null) : PHASE_ROWS;
  if (rows.length === 0) return null;

  /** Off → mild → moderate → severe → off, with the ceiling given its own haptic. */
  function cycle(phase: PhaseRow["phase"], sign: -1 | 1) {
    const current = values[phase];
    const magnitude = sideMagnitude(current, sign);
    if (magnitude === 0) {
      haptic("light");
      onSet(phase, sign);
      return;
    }
    if (magnitude < 3) {
      const next = (magnitude + 1) as 2 | 3;
      haptic(next === 3 ? "medium" : "light");
      onSet(phase, (sign * next) as PhaseBalance);
      return;
    }
    haptic("light");
    onSet(phase, null);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-secondary">
      {/* Said once, over the column it names — not six times down the card. */}
      <div className={cn("grid gap-px border-b border-border py-[7px]", BALANCE_COLS)}>
        <span />
        <span className="pl-2.5 font-sans text-[9.5px] font-bold uppercase tracking-[0.06em] text-faint">
          Understeer
        </span>
        <span />
        <span className="pr-2.5 text-right font-sans text-[9.5px] font-bold uppercase tracking-[0.06em] text-faint">
          Oversteer
        </span>
      </div>

      {/* The seams are the grid gap showing the container's border colour through. */}
      <div
        role="radiogroup"
        aria-label="Corner balance"
        aria-readonly={readOnly || undefined}
        className={cn("grid gap-px bg-border", BALANCE_COLS)}
      >
        {rows.map((row) => {
          const value = values[row.phase];
          return (
            <Fragment key={row.phase}>
              <div className="flex min-h-[44px] items-center bg-secondary pl-2.5 font-sans text-[11px] font-semibold tracking-tight text-foreground">
                {row.label}
              </div>
              <BalanceZone
                phaseLabel={row.label}
                sign={-1}
                value={value}
                onPress={() => cycle(row.phase, -1)}
                readOnly={readOnly}
              />
              <BalanceNeutral
                phaseLabel={row.label}
                isNeutral={value === 0}
                onPress={() => {
                  haptic("light");
                  onSet(row.phase, value === 0 ? null : 0);
                }}
                readOnly={readOnly}
              />
              <BalanceZone
                phaseLabel={row.label}
                sign={1}
                value={value}
                onPress={() => cycle(row.phase, 1)}
                readOnly={readOnly}
              />
            </Fragment>
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
  readOnly = false,
}: {
  label: string;
  severity: 1 | 2 | 3 | null;
  onCycle: () => void;
  readOnly?: boolean;
}) {
  const active = severity != null;
  const shellClass = cn(
    "flex flex-col gap-2 rounded-lg border p-2.5 text-left",
    active ? "border-destructive/60 bg-destructive/10" : "border-border bg-secondary"
  );
  const labelEl = (
    <span
      className={cn(
        "font-sans text-[11.5px] font-semibold leading-tight tracking-tight",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
    </span>
  );
  const steps = (
    <span aria-hidden className="mt-auto flex h-[10px] items-end gap-[3px]">
      {SEVERITIES.map((s) => (
        <span
          key={s}
          className={cn(
            "w-full rounded-[1.5px]",
            !readOnly && "transition-colors duration-150",
            severity != null && s <= severity ? "bg-destructive" : "bg-muted"
          )}
          style={{ height: SEVERITY_STEP_H[s] }}
        />
      ))}
    </span>
  );

  // Read-back keeps the unflagged tiles greyed rather than dropping them: they are the
  // record of what was considered and dismissed, which a list of only the flagged ones
  // silently loses. The staircase is aria-hidden either way, so the severity word has to
  // reach a screen reader in text.
  if (readOnly) {
    return (
      <div className={shellClass}>
        {labelEl}
        <span className="sr-only">
          {active ? HANDLING_SEVERITY_CHIP_LABELS[severity] : "not flagged"}
        </span>
        {steps}
      </div>
    );
  }

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
        shellClass,
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {labelEl}
      {steps}
    </button>
  );
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange?: (next: HandlingAssessmentUiState) => void;
  /**
   * Session read-back (`RunDetailPanel`). Same controls, same marks, no taps — the driver
   * answered these by placing a dot on a lane and raising a staircase, so that is what the
   * session shows back. The prose formatters
   * (`formatHandlingAssessmentForEngineer`) are untouched and still feed the Engineer;
   * this changes only what the driver reads.
   */
  readOnly?: boolean;
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

export function HandlingAssessmentFields({ value, onChange, readOnly = false }: Props) {
  const [balanceInfoOpen, setBalanceInfoOpen] = useState(false);
  const primaryFocusOptions = useMemo(() => buildPrimaryFocusOptions(value), [value]);
  const primaryFocusId = selectedPrimaryFocusId(value);

  function emit(next: HandlingAssessmentUiState) {
    if (readOnly) return;
    onChange?.(patch(next));
  }

  const balanceValues: Record<PhaseRow["phase"], PhaseBalance | null> = {
    entry: value.balanceEntry,
    mid: value.balanceMid,
    exit: value.balanceExit,
  };

  /** The instrument decides the next value (including `null` for "didn't say"); this
      only writes it. */
  function setPhaseBalance(phase: PhaseRow["phase"], next: PhaseBalance | null) {
    const row = PHASE_ROWS.find((r) => r.phase === phase);
    if (!row) return;
    emit({ ...value, [row.stateKey]: next });
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

  /* Primary focus only earns its place once there's a genuine choice to make — with 0–1 flagged
     issues the main problem is implicit (HANDLING_CAPTURE_NORTH_STAR). On read-back the question
     is already answered, so the bar is simply whether an answer exists. */
  const showPrimaryFocus = readOnly ? value.primaryFocus != null : primaryFocusOptions.length >= 2;

  /* Read-back drops whole blocks that were never answered — an untouched section is not
     information, it's an empty form. Inside the balance block it goes further and drops
     the unanswered *phases* too (founder 2026-08-03); the notables still show their
     greyed tiles, because there the unflagged ones are the record of what was considered
     and dismissed. */
  const anyBalance = PHASE_ROWS.some((row) => value[row.stateKey] != null);
  const anyNotable = NOTABLE_TILES.some((t) => {
    const cur = value[t.axis];
    return cur != null && cur !== 0 && Math.sign(cur) === t.sign;
  });
  const showBalance = !readOnly || anyBalance;
  const showNotables = !readOnly || anyNotable;

  return (
    <div className="space-y-4 inset-panel p-3">
      {showBalance ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Corner balance</span>
            {readOnly ? null : (
              <button
                type="button"
                aria-expanded={balanceInfoOpen}
                onClick={() => setBalanceInfoOpen((v) => !v)}
                className="font-sans text-[11px] text-faint underline decoration-border underline-offset-[3px] transition-colors hover:text-muted-foreground"
              >
                What&apos;s this?
              </button>
            )}
          </div>
          {balanceInfoOpen && !readOnly ? (
            <p className="text-[10px] leading-snug text-muted-foreground">{PHASE_BALANCE_INFO}</p>
          ) : null}

          <BalanceInstrument values={balanceValues} onSet={setPhaseBalance} readOnly={readOnly} />

          {readOnly ? null : (
            <p className="ui-caption">
              Tap a side to flag it, again for worse — mild, moderate, severe, then off. The dot in
              the middle means it felt neutral.
            </p>
          )}
        </div>
      ) : null}

      {showNotables ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            {readOnly ? "Notable" : "Anything notable? Only what was a problem."}
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
                  readOnly={readOnly}
                />
              );
            })}
          </div>
          {readOnly ? null : (
            <p className="ui-caption">
              Tap to flag. Tap again for worse — mild, moderate, severe, then off.
            </p>
          )}
        </div>
      ) : null}

      {showPrimaryFocus ? (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            {readOnly ? "Mattered most" : "Which one mattered most?"}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Primary focus">
            {primaryFocusOptions
              .filter((o) => !readOnly || primaryFocusId === o.id)
              .map((o) => {
                const selected = primaryFocusId === o.id;
                const chipClass = cn(chipToggleClass(selected), "px-2.5 py-1 text-[11px]");
                if (readOnly) {
                  return (
                    <span key={o.id} className={cn(chipClass, "pointer-events-none")}>
                      {o.label}
                    </span>
                  );
                }
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => emit({ ...value, primaryFocus: selected ? null : o.focus })}
                    className={chipClass}
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

/**
 * Does a parsed assessment have anything the read-only panel can draw? Guards the call
 * site so a run with only legacy fields (or nothing) doesn't render an empty inset panel.
 */
export function hasRenderableHandlingReadback(ui: HandlingAssessmentUiState): boolean {
  if (PHASE_ROWS.some((row) => ui[row.stateKey] != null)) return true;
  if (ui.primaryFocus != null) return true;
  return NOTABLE_TILES.some((t) => {
    const cur = ui[t.axis];
    return cur != null && cur !== 0 && Math.sign(cur) === t.sign;
  });
}

function selectedPrimaryFocusId(ui: HandlingAssessmentUiState): string {
  if (!ui.primaryFocus) return "";
  const id = JSON.stringify(ui.primaryFocus);
  const opts = buildPrimaryFocusOptions(ui);
  return opts.some((o) => o.id === id) ? id : "";
}
