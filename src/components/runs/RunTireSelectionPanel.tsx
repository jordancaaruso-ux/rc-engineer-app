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
  tireAgeReadoutLine,
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
 * - The answer line under it opens "Carried on ·" when the number came from the
 *   last run, so a carried count is never mistaken for one the driver entered.
 * - Fixing it is one tap on the row that is already showing it. `4+` grows the
 *   row in place rather than handing off to a stepper.
 *
 * No numeral is shown for the state. "run 1" reads as an index, so a fresh set
 * says **New tires**; a carried set says how many runs are *on* them and promises
 * the run number in the sub-line. Anything meaning different rubber clears the
 * stint id, and the server mints a fresh one on save.
 *
 * ONE END OF A FRONT/REAR CAR (2026-09-19). An off-road car logs its front and rear tires apart,
 * each with its own count, and `RunSplitTireSelectionPanel` mounts this panel twice with
 * `variant="compact"`. Every rule above is the same — that is why it is this panel and not a
 * copy — but the presentation is cut down so both ends fit one phone screen: the end's name for
 * a heading, the insert/wheel row in `children`, the chips, and the answer on one line.
 *
 * ONE LINE ON EVERY CAR (founder pick 2026-09-26, "C" off a bench of the real Tires step). The
 * one-tire form used to answer in a big "On the car now" box — dashed edge, yellow stripe, spaced
 * capitals — the only box of its kind in the app, under a grey line saying where the count came
 * from ("No previous run on this car, so assumed a fresh set"; his words: remove it). Both are
 * gone: the full variant answers on the same line as a front/rear end, so every car's Tires step
 * reads alike, and the lit chip above it already says the count.
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

  const line = tireAgeReadoutLine(source, value);
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

  if (variant === "compact") {
    const endName = end === "front" ? "Front" : "Rear";
    return (
      <div className="space-y-2">
        <Eyebrow>{endName}</Eyebrow>
        <TireTypeCombobox
          value={tireTypeId}
          carId={carId}
          bucket={bucket}
          end={end}
          onChange={(id) => handleCompoundChange(id, null)}
          onSelectedTypeChange={(opt) => {
            if (opt) handleCompoundChange(opt.id, opt.displayName);
          }}
          className={prefillFieldClass}
          placeholder={`${endName} tire…`}
          aria-label={`${endName} tire compound`}
        />
        {children}
        <div
          className={cn(
            "flex gap-1.5",
            expanded ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap"
          )}
          role="group"
          aria-label={`Runs on the ${endName.toLowerCase()} tires`}
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
        {line ? <div className="text-[12px] font-medium text-foreground">{line}</div> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Eyebrow>Compound</Eyebrow>
        {locked ? (
          <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
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
            onChange={(id) => handleCompoundChange(id, null)}
            onSelectedTypeChange={(opt) => {
              if (opt) handleCompoundChange(opt.id, opt.displayName);
            }}
            className={prefillFieldClass}
            aria-label="Tire compound"
          />
        )}
      </div>

      <div className="space-y-2">
        <Eyebrow>Runs on these tires</Eyebrow>

        <div
          className={cn(
            "flex gap-1.5",
            expanded ? "flex-nowrap overflow-x-auto pb-1" : "flex-wrap"
          )}
          role="group"
          aria-label="Runs on these tires"
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

        {/* The answer on one line, exactly as a front/rear end shows it (see the header). Before a
            compound is picked the dimmed chips need one prompt; while the car's last run is still
            loading there is no answer yet, so nothing. */}
        {line ? (
          <div className="text-[12px] font-medium text-foreground">{line}</div>
        ) : !tireTypeId ? (
          <div className="text-[11px] leading-snug text-muted-foreground">
            Pick a compound and this fills itself in.
          </div>
        ) : null}
      </div>

      {copyTireWarning ? (
        <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div>
      ) : null}
    </div>
  );
}
