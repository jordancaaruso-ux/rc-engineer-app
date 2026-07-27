"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { TireTypeCombobox } from "@/components/tires/TireTypeCombobox";

/**
 * Tires are defined by how many runs are on them — not by a named set you point
 * at. Two segments drove this: the top-mod racer fits new rubber ~75% of runs and
 * only cares about runs 1-2-3; the club racer runs one set for two days and wants
 * a rough sense of tiredness around 10-14. Neither is asking which set they're on.
 *
 * So the step is a compound plus a number, and **the number is the control** —
 * tapping it opens the one surface that produces every outcome: an exact count,
 * "brand new" (reset to 1), or "not sure" (honest missing data rather than a
 * guess written in as fact). Anything that means different rubber went on clears
 * the stint id, and the server mints a fresh one on save.
 */

export type TireStintValue = {
  /** Runs completed on this rubber BEFORE this run. Displayed count is this + 1. */
  runsCompleted: number;
  /** False when the driver said "not sure" — the count is relative, not absolute tire age. */
  ageKnown: boolean;
  /** Null means "different rubber went on" — the server mints a new stint on save. */
  stintId: string | null;
};

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
  /** Optional hook for callers that need to know the driver set the count by hand. */
  onUserTouched?: () => void;
  onPrefillClear?: () => void;
  copyTireWarning?: string | null;
  prefillFieldClass?: string;
};

function chipClass(selected: boolean) {
  return cn(chipToggleClass(selected), "px-3 py-2 text-xs text-left max-w-full truncate");
}

export function RunTireSelectionPanel({
  tireTypeId,
  onTireTypeChange,
  specTireType,
  preferredTireType,
  value,
  onChange,
  onUserTouched,
  onPrefillClear,
  copyTireWarning,
  prefillFieldClass,
}: Props) {
  const [editing, setEditing] = useState(false);
  const specAppliedRef = useRef(false);
  const preferredAppliedRef = useRef(false);

  const runNumber = value.runsCompleted + 1;
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
      onUserTouched?.();
      onPrefillClear?.();
      onChange(next);
    },
    [onChange, onPrefillClear, onUserTouched]
  );

  const nudge = useCallback(
    (delta: number) => {
      const nextCompleted = Math.max(0, value.runsCompleted + delta);
      // Hand-setting a count means different rubber went on: drop the stint and
      // treat the number as known (the driver just told us what it is).
      commit({ runsCompleted: nextCompleted, ageKnown: true, stintId: null });
    },
    [commit, value.runsCompleted]
  );

  const chooseBrandNew = useCallback(() => {
    commit({ runsCompleted: 0, ageKnown: true, stintId: null });
    setEditing(false);
  }, [commit]);

  const chooseUnsure = useCallback(() => {
    commit({ runsCompleted: 0, ageKnown: false, stintId: null });
    setEditing(false);
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

      <div className="space-y-1.5">
        <Eyebrow>Runs on these tires</Eyebrow>

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          aria-label="Change how many runs are on these tires"
          className={cn(
            "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
            value.ageKnown
              ? "border-border bg-secondary/40 hover:bg-muted"
              : "border-dashed border-border bg-transparent hover:bg-muted"
          )}
        >
          <span
            className={cn(
              "w-11 shrink-0 text-center font-mono text-2xl leading-none tabular-nums",
              value.ageKnown ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {value.ageKnown ? runNumber : "?"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">
              {value.ageKnown ? `run ${runNumber} on these` : "age unknown"}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {value.ageKnown
                ? value.runsCompleted === 0
                  ? "first run on them"
                  : `${value.runsCompleted} run${value.runsCompleted === 1 ? "" : "s"} before this one`
                : value.runsCompleted === 0
                  ? "first run since you got them"
                  : `${value.runsCompleted} run${value.runsCompleted === 1 ? "" : "s"} since you got them`}
            </span>
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            {editing ? "close" : "change"}
          </span>
        </button>

        {editing ? (
          <div className="space-y-3 rounded-xl border border-border bg-secondary/40 px-3 py-3">
            <div className="flex items-center justify-center gap-4" role="group" aria-label="Runs on these tires">
              <button
                type="button"
                className="btn-surface h-10 w-10 font-mono text-base leading-none"
                aria-label="One fewer run"
                disabled={value.runsCompleted <= 0}
                onClick={() => nudge(-1)}
              >
                −
              </button>
              <span className="w-14 text-center font-mono text-2xl tabular-nums text-foreground">
                {runNumber}
              </span>
              <button
                type="button"
                className="btn-surface h-10 w-10 font-mono text-base leading-none"
                aria-label="One more run"
                onClick={() => nudge(1)}
              >
                +
              </button>
            </div>

            <div className="text-center text-[11px] text-muted-foreground">
              This log will be <span className="font-medium text-foreground">run {runNumber}</span>.
            </div>

            <div className="flex flex-col gap-1.5">
              <button type="button" className={chipClass(false)} onClick={chooseBrandNew}>
                Brand new — start at 1
              </button>
              <button
                type="button"
                className={chipClass(!value.ageKnown)}
                aria-pressed={!value.ageKnown}
                onClick={chooseUnsure}
              >
                Not sure how many
              </button>
            </div>

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
