"use client";

import { cn } from "@/lib/utils";
import {
  HANDLING_SEVERITY_LABELS,
  HANDLING_TRAIT_LABELS,
  HANDLING_TRAIT_TAG_IDS,
  type CornerPhase,
  type HandlingAssessmentUiState,
  type HandlingSeverity,
  type HandlingTraitTagId,
} from "@/lib/runHandlingAssessment";
import { HandlingCornerAnimation } from "@/components/runs/HandlingCornerAnimation";

const PHASES: { id: CornerPhase; label: string }[] = [
  { id: "entry", label: "Entry" },
  { id: "mid", label: "Mid" },
  { id: "exit", label: "Exit" },
];

const SEVERITY_OPTIONS = (Object.keys(HANDLING_SEVERITY_LABELS) as HandlingSeverity[]).map((id) => ({
  id,
  label: HANDLING_SEVERITY_LABELS[id],
}));

function togglePhase(
  block: { entry?: boolean; mid?: boolean; exit?: boolean } | null,
  phase: CornerPhase
): { entry?: boolean; mid?: boolean; exit?: boolean } {
  if (!block || Object.keys(block).length === 0) {
    return { [phase]: true };
  }
  const next = { ...block };
  if (next[phase]) {
    delete next[phase];
  } else {
    next[phase] = true;
  }
  const keys = Object.keys(next).filter((k) => next[k as CornerPhase] === true);
  return keys.length ? next : {};
}

function toggleTrait(tags: HandlingTraitTagId[], id: HandlingTraitTagId): HandlingTraitTagId[] {
  if (tags.includes(id)) return tags.filter((t) => t !== id);
  return [...tags, id];
}

type Props = {
  value: HandlingAssessmentUiState;
  onChange: (next: HandlingAssessmentUiState) => void;
};

export function HandlingAssessmentFields({ value, onChange }: Props) {
  const setBalance = (
    key: "understeer" | "oversteer",
    nextBlock: { entry?: boolean; mid?: boolean; exit?: boolean } | null
  ) => {
    onChange({ ...value, [key]: nextBlock });
  };

  const toggleBalance = (key: "understeer" | "oversteer") => {
    const cur = value[key];
    if (cur == null) setBalance(key, {});
    else setBalance(key, null);
  };

  const flipPhase = (key: "understeer" | "oversteer", phase: CornerPhase) => {
    const cur = value[key];
    setBalance(key, togglePhase(cur ?? {}, phase));
  };

  return (
    <div className="space-y-4 rounded-md border border-border/80 bg-muted/30 p-3">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Balance (pick corner phase)</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition",
              value.understeer != null
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
            onClick={() => toggleBalance("understeer")}
          >
            Understeer
          </button>
          <button
            type="button"
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium transition",
              value.oversteer != null
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            )}
            onClick={() => toggleBalance("oversteer")}
          >
            Oversteer
          </button>
        </div>
        {value.understeer != null ? (
          <div className="flex flex-col gap-3 pl-1 sm:flex-row sm:flex-wrap sm:items-start">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Understeer:</span>
                {PHASES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px] font-medium transition",
                      value.understeer?.[id]
                        ? "border-accent bg-accent/15 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => flipPhase("understeer", id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Severity:</span>
                {SEVERITY_OPTIONS.map(({ id, label }) => {
                  const on = value.understeerSeverity === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11px] font-medium transition",
                        on
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => onChange({ ...value, understeerSeverity: id })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <HandlingCornerAnimation
              balance="understeer"
              phases={value.understeer}
              severity={value.understeerSeverity}
            />
          </div>
        ) : null}
        {value.oversteer != null ? (
          <div className="flex flex-col gap-3 pl-1 sm:flex-row sm:flex-wrap sm:items-start">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Oversteer:</span>
                {PHASES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px] font-medium transition",
                      value.oversteer?.[id]
                        ? "border-accent bg-accent/15 text-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => flipPhase("oversteer", id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Severity:</span>
                {SEVERITY_OPTIONS.map(({ id, label }) => {
                  const on = value.oversteerSeverity === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={on}
                      className={cn(
                        "rounded border px-2 py-0.5 text-[11px] font-medium transition",
                        on
                          ? "border-accent bg-accent/15 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => onChange({ ...value, oversteerSeverity: id })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <HandlingCornerAnimation
              balance="oversteer"
              phases={value.oversteer}
              severity={value.oversteerSeverity}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Quick traits</div>
        <div className="flex flex-wrap gap-2">
          {HANDLING_TRAIT_TAG_IDS.map((id) => {
            const on = value.traitTags.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[11px] font-medium transition",
                  on
                    ? "border-accent bg-accent/15 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
                onClick={() =>
                  onChange({ ...value, traitTags: toggleTrait(value.traitTags, id) })
                }
              >
                {HANDLING_TRAIT_LABELS[id]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-traits-other">
          Other traits
        </label>
        <input
          id="handling-traits-other"
          className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
          placeholder="Short free text (e.g. snaps on power)…"
          value={value.traitsOther}
          onChange={(e) => onChange({ ...value, traitsOther: e.target.value })}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-main-problem">
            Main problem to solve
          </label>
          <input
            id="handling-main-problem"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            placeholder="Optional"
            value={value.mainProblem}
            onChange={(e) => onChange({ ...value, mainProblem: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="handling-car-well">
            What the car does well
          </label>
          <input
            id="handling-car-well"
            className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-xs outline-none"
            placeholder="Optional"
            value={value.carDoesWell}
            onChange={(e) => onChange({ ...value, carDoesWell: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
