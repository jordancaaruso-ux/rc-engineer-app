"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";
import {
  deriveTireChoice,
  isDifferentTires,
  tireAgeReadout,
  tireCountLabel,
  type TireChoice,
} from "@/lib/tires/tireAgeReadout";
import type { TireStintValue } from "@/lib/tires/tireStintValue";

/**
 * Tires are defined by how many runs are on them — not by a named set you point
 * at. Two segments drove this: the top-mod racer fits new rubber ~75% of runs and
 * only cares about runs 1-2-3; the club racer runs one set for two days and wants
 * a rough sense of tiredness around 10-14. Neither is asking which set they're on.
 *
 * So the driver answers one question in two steps — **same tires as last run, or
 * different?**, then **brand new or used?** — and only the used branch needs a
 * number. Nothing counts up on its own: the +1 is written on the control the
 * driver taps, because a silent carry-over is invisible and a silent reset is the
 * bug the old `runsCompleted = 0` default caused.
 *
 * No numeral is shown for the state. "run 1" reads as an index, so a fresh set
 * says **New tires**; a carried set says how many runs are *on* them and promises
 * the run number in the sub-line. Anything meaning different rubber clears the
 * stint id, and the server mints a fresh one on save.
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

export function RunTireSelectionPanel({
  tireTypeId,
  onTireTypeChange,
  specTireType,
  preferredTireType,
  value,
  onChange,
  resetSignal,
  onUserTouched,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<TireChoice>(() => deriveTireChoice(value));
  const specAppliedRef = useRef(false);
  const preferredAppliedRef = useRef(false);

  // What "same tires" means: the stint as it arrived, before any tapping. Kept so
  // tapping back after a mis-tap on "Different tires" restores it rather than
  // leaving the driver to re-enter a count the form already knew.
  const carriedRef = useRef<TireStintValue>(value);
  // Our own last commit, so the sync effect below can ignore the echo of it.
  const committedKeyRef = useRef<string | null>(null);

  const incomingKey = valueKey(value);

  // Re-read the value whenever it changes from outside — form hydration, dashboard
  // prefill, restoring a draft, switching car. Our own commits are skipped so a
  // brand-new set (0 runs, no stint) isn't mistaken for an unanswered one.
  useEffect(() => {
    if (committedKeyRef.current === incomingKey) return;
    committedKeyRef.current = null;
    carriedRef.current = value;
    setChoice(deriveTireChoice(value));
    setEditing(false);
    // `value` is covered by `incomingKey`; listing it would re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingKey, resetSignal]);

  const readout = tireAgeReadout(choice, value);
  const differentSelected = isDifferentTires(choice);
  const locked = Boolean(specTireType);

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

  const commit = useCallback(
    (next: TireStintValue) => {
      committedKeyRef.current = valueKey(next);
      onUserTouched?.();
      onPrefillClear?.();
      onChange(next);
    },
    [onChange, onPrefillClear, onUserTouched]
  );

  const chooseSame = useCallback(() => {
    const carried = carriedRef.current;
    setChoice("same");
    setEditing(false);
    commit(
      carried.stintId != null || carried.runsCompleted > 0
        ? { ...carried }
        : { runsCompleted: value.runsCompleted, ageKnown: true, stintId: value.stintId }
    );
  }, [commit, value.runsCompleted, value.stintId]);

  /**
   * Different rubber, new-or-used not answered yet. Recorded as unknown age rather
   * than guessed at, so a run saved without answering is honestly missing the
   * count instead of inheriting the previous set's.
   */
  const chooseDifferent = useCallback(() => {
    setChoice("different");
    setEditing(false);
    commit({ runsCompleted: 0, ageKnown: false, stintId: null });
  }, [commit]);

  const chooseBrandNew = useCallback(() => {
    setChoice("new");
    setEditing(false);
    commit({ runsCompleted: 0, ageKnown: true, stintId: null });
  }, [commit]);

  /** A used set always needs a number, so land straight on the stepper. */
  const chooseUsed = useCallback(() => {
    setChoice("used");
    setEditing(true);
    commit({ runsCompleted: 1, ageKnown: true, stintId: null });
  }, [commit]);

  const nudge = useCallback(
    (delta: number) => {
      const nextCompleted = Math.max(0, value.runsCompleted + delta);
      // Hand-setting a count means different rubber went on: drop the stint and
      // treat the number as known (the driver just told us what it is).
      setChoice((c) => (c === null || c === "different" ? "used" : c));
      commit({ runsCompleted: nextCompleted, ageKnown: true, stintId: null });
    },
    [commit, value.runsCompleted]
  );

  const chooseUnsure = useCallback(() => {
    setChoice("used");
    setEditing(false);
    commit({ runsCompleted: 0, ageKnown: false, stintId: null });
  }, [commit]);

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
            onChange={(id) => onTireTypeChange(id, null)}
            onSelectedTypeChange={(opt) => {
              if (opt) onTireTypeChange(opt.id, opt.displayName);
            }}
            className={prefillFieldClass}
            aria-label="Tire compound"
          />
        )}
      </div>

      <div className="space-y-2">
        <Eyebrow>Tires on the car</Eyebrow>

        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tires on the car">
          <button
            type="button"
            aria-pressed={choice === "same"}
            onClick={chooseSame}
            className={cn(
              chipToggleClass(choice === "same"),
              "flex flex-col items-start gap-px px-3 py-2 text-left text-[13px]",
              choice === null && "border-dashed"
            )}
          >
            <span>Same tires</span>
            <span className="text-[10.5px] font-normal text-muted-foreground">+1 run</span>
          </button>
          <button
            type="button"
            aria-pressed={differentSelected}
            onClick={chooseDifferent}
            className={cn(
              chipToggleClass(differentSelected),
              "flex flex-col items-start gap-px px-3 py-2 text-left text-[13px]",
              choice === null && "border-dashed"
            )}
          >
            <span>Different tires</span>
            <span className="text-[10.5px] font-normal text-muted-foreground">new or used</span>
          </button>
        </div>

        {/* Indented under the button that asked, so it reads as that button's
            follow-up rather than a second, unrelated row of choices. */}
        {differentSelected ? (
          <div className="ml-[calc(50%+0.25rem)] max-[460px]:ml-0 border-l-2 border-foreground/20 pl-2.5 space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Which set went on?
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                aria-pressed={choice === "new"}
                onClick={chooseBrandNew}
                className={cn(chipToggleClass(choice === "new"), "px-2.5 py-2 text-xs")}
              >
                Brand new
              </button>
              <button
                type="button"
                aria-pressed={choice === "used"}
                onClick={chooseUsed}
                className={cn(chipToggleClass(choice === "used"), "px-2.5 py-2 text-xs")}
              >
                Used set
              </button>
            </div>
          </div>
        ) : null}

        {/* The answer, not another option: raised off the card, its own label, the
            biggest type in the section, and a yellow rail — which reads as
            emphasis rather than an action, since a rail is never pressable. */}
        <div
          className={cn(
            "flex items-start gap-2.5 rounded-xl border bg-muted py-3 pr-3 pl-[0.9375rem]",
            "shadow-[inset_3px_0_0_0_rgb(var(--color-primary))]",
            readout.unresolved ? "border-dashed border-border" : "border-foreground/15"
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="mb-[3px] text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              On the car now
            </div>
            <div
              className={cn(
                "text-[17px] tracking-tight",
                readout.unresolved
                  ? "font-medium text-muted-foreground"
                  : "font-semibold text-foreground"
              )}
            >
              {readout.title}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{readout.sub}</div>
          </div>
          <button
            type="button"
            className="btn-surface inline-flex shrink-0 items-center gap-1.5 self-center px-3 py-2 text-xs font-semibold"
            aria-expanded={editing}
            aria-label="Change how many runs are on these tires"
            onClick={() => {
              setEditing((v) => !v);
              setChoice((c) => (c === null ? "same" : c));
            }}
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {editing ? "Close" : "Change"}
          </button>
        </div>

        {editing ? (
          <div className="space-y-3 rounded-xl border border-border bg-secondary/40 px-3 py-3">
            <div
              className="flex items-center justify-center gap-4"
              role="group"
              aria-label="Runs on these tires"
            >
              <button
                type="button"
                className="btn-surface h-10 w-10 text-base leading-none"
                aria-label="One fewer run"
                disabled={value.runsCompleted <= 0}
                onClick={() => nudge(-1)}
              >
                −
              </button>
              <span className="min-w-[5.75rem] text-center text-[15px] font-semibold tabular-nums tracking-tight text-foreground">
                {tireCountLabel(value.runsCompleted)}
              </span>
              <button
                type="button"
                className="btn-surface h-10 w-10 text-base leading-none"
                aria-label="One more run"
                onClick={() => nudge(1)}
              >
                +
              </button>
            </div>

            <div className="text-center text-[11.5px] text-muted-foreground">
              This log will be{" "}
              <span className="font-semibold text-foreground">run {value.runsCompleted + 1}</span>.
            </div>

            <button
              type="button"
              className={cn(
                chipToggleClass(!value.ageKnown),
                "w-full px-3 py-2 text-left text-xs"
              )}
              aria-pressed={!value.ageKnown}
              onClick={chooseUnsure}
            >
              Not sure how many
            </button>

            {!value.ageKnown ? (
              <div className="text-[11px] leading-snug text-muted-foreground">
                I&apos;ll still track how they fade from here — I just can&apos;t tell you where in
                their life they are.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {copyTireWarning ? (
        <div className="text-[11px] text-muted-foreground">{copyTireWarning}</div>
      ) : null}
    </div>
  );
}
