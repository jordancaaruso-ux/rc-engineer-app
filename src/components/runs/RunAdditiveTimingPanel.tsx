"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PrepSlider } from "@/components/ui/PrepSlider";
import { haptic } from "@/lib/haptics";
import {
  AdditiveDropIcon,
  WarmerSteamIcon,
  TowelRollIcon,
} from "@/components/runs/TirePrepIcons";
import {
  MAX_TIRE_PREP_STEPS,
  TIRE_PREP_TEMP_MIN_C,
  TIRE_PREP_TEMP_MAX_C,
  TIRE_PREP_DEFAULT_MINUTES,
  TIRE_PREP_DEFAULT_TEMP_C,
  newTirePrepStep,
  type TirePrepStep,
} from "@/lib/runs/tirePrep";
import { AdditiveTypeCombobox } from "@/components/additives/AdditiveTypeCombobox";

type Props = {
  additiveTypeId: string;
  onAdditiveTypeIdChange: (id: string) => void;
  /** Ordered tire-prep applications toward the run. */
  tirePrep: TirePrepStep[];
  onTirePrepChange: (steps: TirePrepStep[]) => void;
  prefillFieldClass?: string;
  requireAdditive?: boolean;
  highlightMissing?: boolean;
  /**
   * When the linked event mandates a control additive, the run is locked to it
   * (set at the event, not overridable) — the driver can only record they ran
   * none this run. Absent = normal free picker.
   */
  controlAdditive?: { id: string; displayName: string } | null;
};

/** Which slider drawer is open: one per panel, keyed by row + which value. */
type OpenRuler = { row: number; kind: "min" | "temp" } | null;

// Founder-approved ranges (slider artifacts 2026-07-29): the habitual band, not
// the theoretical one. Values logged outside it (old 1–90 tape) still read
// honestly — only the thumb clamps.
const MINUTES_SLIDER = {
  min: 5,
  max: 45,
  step: 1, // every minute reachable (founder, 2026-07-15)
  defaultValue: TIRE_PREP_DEFAULT_MINUTES,
};
const TEMP_SLIDER = {
  min: TIRE_PREP_TEMP_MIN_C,
  max: TIRE_PREP_TEMP_MAX_C,
  step: 5, // 5° steps only — no 1° refinement needed for warmer temps
  defaultValue: TIRE_PREP_DEFAULT_TEMP_C,
};

function ValueChip({
  value,
  unit,
  open,
  onClick,
  ariaLabel,
}: {
  value: number | null;
  unit: string;
  open: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "min-w-[58px] flex-none rounded-lg border px-2 py-1.5 text-center text-[13px] tabular-nums transition",
        open
          ? "border-primary-ink bg-accent/10 text-foreground"
          : "border-border bg-secondary hover:border-muted-foreground/40",
        value == null ? "text-faint" : "text-foreground"
      )}
    >
      {value == null ? "—" : value}
      <span className="ml-px text-[11px] text-faint">{unit}</span>
    </button>
  );
}

function IconToggle({
  on,
  hidden,
  onToggle,
  ariaLabel,
  children,
}: {
  on: boolean;
  hidden?: boolean;
  onToggle: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={() => {
        haptic("light");
        onToggle();
      }}
      className={cn(
        "grid h-[34px] w-[34px] flex-none place-items-center rounded-lg border transition",
        on
          ? "border-primary-ink/60 bg-accent/10 text-primary-ink"
          : "border-border text-faint hover:border-muted-foreground/40 hover:text-muted-foreground",
        hidden && "invisible pointer-events-none"
      )}
    >
      {children}
    </button>
  );
}

export function RunAdditiveTimingPanel({
  additiveTypeId,
  onAdditiveTypeIdChange,
  tirePrep,
  onTirePrepChange,
  prefillFieldClass,
  requireAdditive = false,
  highlightMissing = false,
  controlAdditive = null,
}: Props) {
  // A controlled event locks the additive; "ran none" is the only escape.
  const [ranNone, setRanNone] = useState(false);
  const [openRuler, setOpenRuler] = useState<OpenRuler>(null);
  const controlId = controlAdditive?.id ?? null;

  // Reset the none-escape whenever the mandated additive changes (event switch).
  useEffect(() => {
    setRanNone(false);
  }, [controlId]);

  // Keep the run's additive in sync with the lock: the control unless the driver
  // opted out to none.
  useEffect(() => {
    if (!controlAdditive) return;
    const target = ranNone ? "" : controlAdditive.id;
    if (additiveTypeId !== target) onAdditiveTypeIdChange(target);
  }, [controlAdditive, ranNone, additiveTypeId, onAdditiveTypeIdChange]);

  const updateStep = (i: number, patch: Partial<TirePrepStep>) => {
    onTirePrepChange(tirePrep.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };
  const removeStep = (i: number) => {
    onTirePrepChange(tirePrep.filter((_, idx) => idx !== i));
    setOpenRuler((cur) => {
      if (!cur) return cur;
      if (cur.row === i) return null;
      return cur.row > i ? { ...cur, row: cur.row - 1 } : cur;
    });
  };
  const addStep = () => {
    if (tirePrep.length >= MAX_TIRE_PREP_STEPS) return;
    // Carry the previous step's on/off choices forward; pre-fill the numeric
    // boxes with the logged-by-default values so nothing reads "—".
    const next = newTirePrepStep(tirePrep[tirePrep.length - 1]);
    onTirePrepChange([...tirePrep, next]);
    // The common flow is add → set time: open the new row's minutes ruler.
    setOpenRuler({ row: tirePrep.length, kind: "min" });
  };
  const toggleRuler = (row: number, kind: "min" | "temp") => {
    setOpenRuler((cur) => (cur && cur.row === row && cur.kind === kind ? null : { row, kind }));
  };

  return (
    <div
      className={cn(
        "space-y-3 text-sm",
        prefillFieldClass,
        highlightMissing && "rounded-md ring-2 ring-destructive/40"
      )}
    >
      <Eyebrow dot="muted">Tire prep</Eyebrow>

      {controlAdditive ? (
        <div className="space-y-1.5">
          <div className="type-data-label">Control additive</div>
          <SegmentedControl<"control" | "none">
            ariaLabel="Control additive or none this run"
            size="sm"
            value={ranNone ? "none" : "control"}
            onChange={(v) => setRanNone(v === "none")}
            options={[
              { value: "control", label: controlAdditive.displayName },
              { value: "none", label: "None" },
            ]}
          />
        </div>
      ) : (
      <div className="space-y-2">
          {/* One control, one label (2026-07-28). The "Recently used" chip row that
              sat here duplicated the picker's own Recently-used optgroup from the
              same endpoint — two labels and up to nine chips for a single value,
              with chip-as-state reading like toggles rather than a choice. */}
          <div className="space-y-1">
            <div className="type-data-label">
              Additive{requireAdditive ? " *" : ""}
            </div>
            <AdditiveTypeCombobox
              value={additiveTypeId}
              onChange={onAdditiveTypeIdChange}
              placeholder={requireAdditive ? "Select required additive" : "None or search additive"}
              aria-label="Additive type"
              allowInlineCreate={!requireAdditive}
              allowClear={!requireAdditive}
            />
          </div>
        </div>
      )}

      {/* Applications — ordered prep steps toward the run. One-line rows: minutes,
          additive/warmers/towels icon toggles, temp (warmers only); tapping a
          value opens its ruler in a drawer under the row. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="type-data-label">Applications</span>
          <span className="tabular-nums text-[10px] text-faint">
            {tirePrep.length}/{MAX_TIRE_PREP_STEPS} · toward run
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-white/[0.015]">
          {tirePrep.map((step, i) => {
            const minOpen = openRuler?.row === i && openRuler.kind === "min";
            const tempOpen = openRuler?.row === i && openRuler.kind === "temp";
            return (
              <div key={i} className="border-t border-border first:border-t-0">
                <div className="flex min-h-[48px] items-center gap-2 py-2 pl-3 pr-2.5">
                  <span className="w-3 flex-none text-[11px] tabular-nums text-faint">
                    {i + 1}
                  </span>
                  <ValueChip
                    value={step.minutes}
                    unit="m"
                    open={minOpen}
                    onClick={() => toggleRuler(i, "min")}
                    ariaLabel={`Minutes, application ${i + 1}`}
                  />
                  <div className="ml-0.5 flex flex-none gap-1.5">
                    <IconToggle
                      on={step.appliedAdditive}
                      onToggle={() => updateStep(i, { appliedAdditive: !step.appliedAdditive })}
                      ariaLabel="Additive this application"
                    >
                      <AdditiveDropIcon className="h-[18px] w-[18px]" />
                    </IconToggle>
                    <IconToggle
                      on={step.warmers}
                      onToggle={() => {
                        // Leaving the warmers clears warmer-only detail so it can't linger hidden.
                        if (step.warmers) {
                          updateStep(i, { warmers: false, towels: false, temperatureC: null });
                          if (tempOpen) setOpenRuler(null);
                        } else {
                          // Fill the temp box with the default so it never reads "—".
                          updateStep(i, {
                            warmers: true,
                            temperatureC: step.temperatureC ?? TIRE_PREP_DEFAULT_TEMP_C,
                          });
                        }
                      }}
                      ariaLabel="In warmers"
                    >
                      <WarmerSteamIcon className="h-[18px] w-[18px]" />
                    </IconToggle>
                    <IconToggle
                      on={step.towels}
                      hidden={!step.warmers}
                      onToggle={() => updateStep(i, { towels: !step.towels })}
                      ariaLabel="Towels between warmer and tire"
                    >
                      <TowelRollIcon className="h-[18px] w-[18px]" />
                    </IconToggle>
                  </div>
                  {step.warmers ? (
                    <ValueChip
                      value={step.temperatureC}
                      unit="°"
                      open={tempOpen}
                      onClick={() => toggleRuler(i, "temp")}
                      ariaLabel={`Warmer temperature, application ${i + 1}`}
                    />
                  ) : null}
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label={`Remove application ${i + 1}`}
                    onClick={() => {
                      haptic("light");
                      removeStep(i);
                    }}
                    className="grid h-[26px] w-[26px] flex-none place-items-center rounded-md text-[13px] text-faint transition hover:bg-destructive/10 hover:text-destructive"
                  >
                    ✕
                  </button>
                </div>
                {minOpen || tempOpen ? (
                  <div className="border-t border-border bg-secondary px-3 py-2">
                    {minOpen ? (
                      <PrepSlider
                        value={step.minutes}
                        onChange={(v) => updateStep(i, { minutes: v })}
                        min={MINUTES_SLIDER.min}
                        max={MINUTES_SLIDER.max}
                        step={MINUTES_SLIDER.step}
                        defaultValue={MINUTES_SLIDER.defaultValue}
                        label="Application time"
                        unit="min"
                        withStepper
                        ariaLabel={`Minutes, application ${i + 1}`}
                      />
                    ) : (
                      <PrepSlider
                        value={step.temperatureC}
                        onChange={(v) => updateStep(i, { temperatureC: v })}
                        min={TEMP_SLIDER.min}
                        max={TEMP_SLIDER.max}
                        step={TEMP_SLIDER.step}
                        defaultValue={TEMP_SLIDER.defaultValue}
                        label="Warmer temp"
                        unit="°C"
                        ariaLabel={`Warmer temperature, application ${i + 1}`}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}

          {tirePrep.length === 0 ? (
            <p className="px-3 py-2.5 text-xs text-muted-foreground">No tire prep logged.</p>
          ) : null}

          {tirePrep.length < MAX_TIRE_PREP_STEPS ? (
            <button
              type="button"
              onClick={() => {
                haptic("light");
                addStep();
              }}
              className={cn(
                "w-full py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-white/[0.02] hover:text-foreground",
                tirePrep.length > 0 && "border-t border-dashed border-border"
              )}
            >
              + Add application
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
