"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import {
  applyTireCountChip,
  deriveTireStintForCompound,
  isTireStintUnanswered,
} from "@/lib/tires/deriveTireStint";
import {
  activeTireCountChip,
  expandedTireCountChips,
  tireRunNumber,
  TIRE_COUNT_CHIPS,
  type TireCountChip,
} from "@/lib/tires/tireAgeReadout";
import type { LastRunTires, TireAgeSource, TireStintValue } from "@/lib/tires/tireStintValue";
import type { TireBucket } from "@/lib/cars/tireProfile";
import type { TireEnd } from "@/lib/tires/tireCatalogFilter";

/**
 * Tires are defined by how many runs are on them — not by a named set you point
 * at. Two segments drove this: the top-mod racer fits new rubber ~75% of runs and
 * only cares about runs 1-2-3; the club racer runs one set for two days and wants
 * a rough sense of tiredness around 10-14. Neither is asking which set they're on.
 *
 * So the driver answers *one* question — which compound? — and the age answers
 * itself from the car's last run: same compound means the same rubber went back
 * on, so its stint comes forward one run older; anything else is a fresh set.
 *
 * That carry-over is deliberately silent, reversing the earlier design where the
 * driver had to tap "Same as previous run" or "Different set" before the count
 * row even appeared. Three taps for the commonest case in the sport was the wrong
 * trade. What replaces the question:
 *
 * - The count row is always on screen, so the guess is visible, not buried.
 * - Fixing it is one tap on the row that is already showing it. `4+` grows the
 *   row in place rather than handing off to a stepper.
 *
 * Nothing says a count was carried from the last run. Until 2026-09-26 a line did —
 * a grey hint on one-tire cars, "Carried on ·" in a front/rear end's answer — and
 * the founder picked the run box below over both, told the marker went with them.
 * Anything meaning different rubber clears the stint id, and the server mints a
 * fresh one on save.
 *
 * THE RUN BESIDE THE TIRE (founder picks 2026-09-26, off three benches of the real Tires step).
 * Every tire has a small "Run 4" box beside its compound, at the picker's height — "on the left
 * have the selector, then a small box on the right indicating which run this is", then "build it
 * so every discipline is uniform" — dashed and dimmed like the chips until there is an answer.
 * It replaced a big "On the car now" box on one-tire cars (dashed edge, yellow stripe, spaced
 * capitals: the only box of its kind in the app) and the one-line answer on front/rear ends. The
 * earlier rule was no numeral — "run 1" reads as an index, so a fresh set said **New tires** —
 * but this number is the run itself, the lit "New" chip sits right under it, and he picked it
 * off a bench showing exactly that. A one-tire car also lost its "Runs on these tires" heading
 * and its "Pick a compound" prompt, so both kinds of car read the same.
 *
 * ONE END OF A FRONT/REAR CAR (2026-09-19). An off-road car logs its front and rear tires apart,
 * each with its own count, and `RunSplitTireSelectionPanel` mounts this panel twice with
 * `variant="compact"`. Every rule above is the same — that is why it is this panel and not a
 * copy. The end's name is the heading, and its insert/wheel/diameter row comes in `children`.
 */

export type { TireStintValue };

type Props = {
  tireTypeId: string;
  onTireTypeChange: (tireTypeId: string, displayName: string | null) => void;
  /**
   * When the linked event mandates a controlled/spec tire the compound is locked
   * to it. Set at the event; not overridable in a run.
   */
  specTireType?: { id: string; displayName: string } | null;
  /** Compound to pre-select when nothing is chosen yet (event spec tire). */
  preferredTireType?: { id: string; displayName: string } | null;
  value: TireStintValue;
  onChange: (next: TireStintValue) => void;
  /**
   * The tires on the car's last logged run — what the compound pick is compared
   * against. `null` means the car has no history, so every compound reads as a
   * fresh set.
   *
   * `undefined` means the caller is still finding out (the per-car last-run fetch
   * is in flight). Nothing is derived in that window: guessing on an unloaded
   * `null` writes "New tires" and then swaps it out from under the driver.
   */
  lastRunTires?: LastRunTires | null;
  /** Ranks the compound list by what you run on cars of this car's discipline. */
  carId?: string | null;
  /** The slice of the catalog this car shops from; null = the whole list. */
  bucket?: TireBucket | null;
  /** "compact" = one end of a front/rear car. See the header. */
  variant?: "full" | "compact";
  /** Compact only: which end this is. Names the heading and the controls, sorts the picker. */
  end?: TireEnd;
  /** Compact only: rendered between the tire and its count — the insert / wheel row. */
  children?: ReactNode;
  /**
   * Changes identity when the form swaps to a different context (another car),
   * so an answer given for the old one isn't left standing over the new value.
   */
  resetSignal?: string | number | null;
  /** Optional hook for callers that need to know the driver set the count by hand. */
  onUserTouched?: () => void;
  onPrefillClear?: () => void;
  copyTireWarning?: string | null;
  prefillFieldClass?: string;
};

/** Serialises a value so an echo of our own commit can be told from a fresh one. */
function valueKey(v: TireStintValue): string {
  return `${v.runsCompleted}|${v.ageKnown}|${v.stintId ?? ""}`;
}

/**
 * How to describe a value that arrived from outside — a saved run, a draft, a
 * copy-forward, a car swap. One that matches the last run exactly gets the
 * carried hint; anything else already reflects a real decision, so it says
 * nothing rather than claiming credit for it.
 */
function sourceForIncoming(value: TireStintValue, last: LastRunTires | null): TireAgeSource {
  if (isTireStintUnanswered(value)) return null;
  if (
    last &&
    value.stintId != null &&
    value.stintId === last.tireStintId &&
    value.runsCompleted === last.tireRunNumber &&
    value.ageKnown === last.tireAgeKnown
  ) {
    return "carried";
  }
  return "manual";
}

export function RunTireSelectionPanel({
  tireTypeId,
  onTireTypeChange,
  specTireType,
  preferredTireType,
  value,
  onChange,
  lastRunTires,
  carId,
  bucket,
  variant = "full",
  end,
  children,
  resetSignal,
  onUserTouched,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: Props) {
  const [source, setSource] = useState<TireAgeSource>(() =>
    sourceForIncoming(value, lastRunTires ?? null)
  );
  const [expanded, setExpanded] = useState(false);
  const specAppliedRef = useRef(false);
  const preferredAppliedRef = useRef(false);

  // Our own last commit, so the sync effect below can ignore the echo of it.
  const committedKeyRef = useRef<string | null>(null);

  const incomingKey = valueKey(value);
  // `undefined` (fetch in flight) and `null` (no history) mean different things to
  // the derivation, but only the loaded flag decides whether to derive at all.
  const historyLoaded = lastRunTires !== undefined;
  const last = lastRunTires ?? null;

  // Re-read the value whenever it changes from outside — form hydration, dashboard
  // prefill, restoring a draft, switching car. Our own commits are skipped so a
  // brand-new set (0 runs, no stint) isn't mistaken for an unanswered one.
  useEffect(() => {
    if (committedKeyRef.current === incomingKey) return;
    committedKeyRef.current = null;
    setSource(sourceForIncoming(value, last));
    setExpanded(false);
    // `value` is covered by `incomingKey`; listing it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey, resetSignal]);

  const runNumber = tireRunNumber(source, value);
  const locked = Boolean(specTireType);
  const activeChip = activeTireCountChip(source, value, expanded);
  const chips: readonly TireCountChip[] = useMemo(
    () => (expanded ? expandedTireCountChips(value.runsCompleted) : TIRE_COUNT_CHIPS),
    [expanded, value.runsCompleted]
  );

  const commit = useCallback(
    (next: TireStintValue, opts?: { auto?: boolean }) => {
      committedKeyRef.current = valueKey(next);
      if (!opts?.auto) {
        onUserTouched?.();
        onPrefillClear?.();
      }
      onChange(next);
    },
    [onChange, onPrefillClear, onUserTouched]
  );

  // A spec tire is mandated, so it wins outright; a preferred compound only fills a gap.
  useEffect(() => {
    if (!specTireType || specAppliedRef.current) return;
    specAppliedRef.current = true;
    if (tireTypeId !== specTireType.id) onTireTypeChange(specTireType.id, specTireType.displayName);
  }, [specTireType, tireTypeId, onTireTypeChange]);

  useEffect(() => {
    if (!preferredTireType || preferredAppliedRef.current || specTireType) return;
    if (tireTypeId) return;
    preferredAppliedRef.current = true;
    onTireTypeChange(preferredTireType.id, preferredTireType.displayName);
  }, [preferredTireType, specTireType, tireTypeId, onTireTypeChange]);

  /**
   * Fill in the age for a compound that arrived without one — a mandated control
   * tire, a preferred compound, a draft saved before the count was answered, or a
   * compound picked while the last-run fetch was still in flight. Only ever runs
   * over a value nobody has touched, which is what keeps it off saved runs.
   */
  useEffect(() => {
    if (!historyLoaded || !tireTypeId) return;
    if (source !== null || !isTireStintUnanswered(value)) return;
    const derived = deriveTireStintForCompound(last, tireTypeId);
    setSource(derived.source);
    setExpanded(false);
    commit(derived.value, { auto: true });
    // Same reason as above: `value` is represented by `incomingKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyLoaded, tireTypeId, source, incomingKey, commit]);

  /**
   * Picking a compound decides the age too — that is the whole design.
   *
   * Only when the compound actually *changed*, though. `TireTypeCombobox` also
   * reports the selection once it resolves the display name for a value it was
   * handed, and on an edit or a copy-forward that echo would otherwise re-derive
   * an age over the one already stored on the run.
   */
  const handleCompoundChange = useCallback(
    (nextId: string, displayName: string | null) => {
      const changed = nextId !== tireTypeId;
      onTireTypeChange(nextId, displayName);
      if (!changed) return;
      setExpanded(false);
      if (!historyLoaded) {
        // Nothing to compare against yet; the effect above finishes the job once
        // the fetch lands.
        setSource(null);
        return;
      }
      const derived = deriveTireStintForCompound(last, nextId);
      setSource(derived.source);
      commit(derived.value);
    },
    [commit, historyLoaded, last, onTireTypeChange, tireTypeId]
  );

  /** One tap on the count row, correcting whatever the compound implied. */
  const chooseCount = useCallback(
    (chip: TireCountChip) => {
      const next = applyTireCountChip(chip, value, last, source);
      setSource(next.source);
      // Once the row is open it stays open — collapsing it under the driver's
      // finger hides the answer they just gave.
      if (next.expand) setExpanded(true);
      commit(next.value);
    },
    [commit, last, source, value]
  );

  // A front/rear end is named for its end; a one-tire car's only tire is "the compound".
  const endName = variant === "compact" ? (end === "front" ? "Front" : "Rear") : null;

  // One layout for every car (see the header): heading, the tire with its run box, the end's own
  // boxes, the count row.
  return (
    <div className="space-y-2">
      <Eyebrow>{endName ?? "Compound"}</Eyebrow>
      {/* The box stretches to the picker's height, or to the controlled tire's when an event
          locks it. */}
      <div className="flex items-stretch gap-2">
        {locked ? (
          <div className="min-w-0 flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <div className="text-sm text-foreground">{specTireType!.displayName}</div>
            <div className="text-[11px] text-muted-foreground">
              Controlled tire for this event — set at the event, not here.
            </div>
          </div>
        ) : (
          <TireTypeCombobox
            value={tireTypeId}
            carId={carId}
            bucket={bucket}
            end={end}
            onChange={(id) => handleCompoundChange(id, null)}
            onSelectedTypeChange={(opt) => {
              if (opt) handleCompoundChange(opt.id, opt.displayName);
            }}
            className={cn("min-w-0 flex-1", prefillFieldClass)}
            placeholder={endName ? `${endName} tire…` : undefined}
            aria-label={endName ? `${endName} tire compound` : "Tire compound"}
          />
        )}
        <RunNumberBox run={runNumber} />
      </div>
      {children}
      <div
        className={cn(
          "flex gap-1.5",
          expanded ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap"
        )}
        role="group"
        aria-label={endName ? `Runs on the ${endName.toLowerCase()} tires` : "Runs on these tires"}
      >
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-pressed={activeChip === chip.key}
            disabled={!tireTypeId}
            onClick={() => chooseCount(chip)}
            className={cn(
              chipToggleClass(activeChip === chip.key),
              "shrink-0 px-3 py-2 text-xs",
              !tireTypeId && "border-dashed opacity-50"
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {copyTireWarning ? (
        <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div>
      ) : null}
    </div>
  );
}

/**
 * Which run this will be on the set, beside every compound (see the header): "Run 4", "Run ?"
 * after Not sure, and dashed and dimmed like the chips until there is an answer.
 */
function RunNumberBox({ run }: { run: string | null }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-[5px] rounded-lg border bg-background/45 px-[11px]",
        run ? "border-border" : "border-dashed border-border opacity-[0.55]"
      )}
    >
      <span className="type-data-label">Run</span>
      <span aria-hidden className="text-[15.5px] font-semibold tabular-nums text-foreground">
        {run ?? "–"}
      </span>
      <span className="sr-only">{run === null ? "not set yet" : run === "?" ? "unknown" : run}</span>
    </div>
  );
}
