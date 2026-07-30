"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import {
  buildSetupFillSteps,
  setupFillSections,
  type SetupFillStep,
} from "@/lib/setup/setupFillOrder";
import { coerceSetupValue, type SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Sequential first-fill: one parameter per screen, tick to advance.
 *
 * Deliberately a *separate* surface from the grid sheet (`SetupSheetStructured`), which stays the
 * way you edit an existing setup. This one exists for the case the grid is bad at — sitting down
 * with a car and entering 150 values from scratch — so it optimises for rhythm: big target, one
 * decision, auto-advance on a tap, never a scroll hunt.
 *
 * Values are written with the same stored tokens the grid writes (`optionValues` from the schema),
 * so a setup filled here and a setup edited there are indistinguishable downstream.
 */

type Props = {
  template: SetupSheetTemplate;
  /** Pre-filled starting values (kit setup, last setup, or {}). */
  initialValues: SetupSnapshotData;
  /** Shown above the progress bar, e.g. "Xray X4'26". */
  subject: string;
  saveLabel?: string;
  saving?: boolean;
  error?: string | null;
  onSave: (values: SetupSnapshotData) => void;
  onCancel: () => void;
};

function readMulti(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Stored token for an option label, honouring the schema's declared values. */
function tokenFor(step: SetupFillStep, index: number): string {
  return step.optionValues?.[index] ?? step.options?.[index] ?? "";
}

function isAnswered(step: SetupFillStep, value: unknown): boolean {
  if (step.kind === "multiChoice") return readMulti(value).length > 0;
  if (value == null) return false;
  return String(value).trim() !== "";
}

export function SetupFillFlow({
  template,
  initialValues,
  subject,
  saveLabel = "Save setup",
  saving = false,
  error,
  onSave,
  onCancel,
}: Props) {
  const steps = useMemo(() => buildSetupFillSteps(template), [template]);
  const sections = useMemo(() => setupFillSections(steps), [steps]);
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const [index, setIndex] = useState(0);
  const [showSections, setShowSections] = useState(false);
  // Raw string the user is typing into a text/number step. Kept separate from the stored value so
  // an in-progress decimal ("3.") survives keystrokes — coercing on every change turned 3.2 into 32.
  const [draft, setDraft] = useState("");
  const textRef = useRef<HTMLInputElement | null>(null);

  const step = steps[index];
  const atEnd = index >= steps.length;

  // On arrival at a text/number step, seed the draft from the stored value and focus so typing can
  // start immediately (choice steps are taps). Reseed only on step change, never on commit, so a
  // committed value doesn't wipe what you're typing.
  useEffect(() => {
    if (step && (step.kind === "text" || step.kind === "number")) {
      const stored = values[step.key];
      setDraft(stored == null ? "" : String(stored));
      textRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on step change only, not `values`
  }, [index, step]);

  const answeredCount = useMemo(
    () => steps.reduce((n, s) => (isAnswered(s, values[s.key]) ? n + 1 : n), 0),
    [steps, values]
  );

  const setValue = useCallback((key: string, next: SetupSnapshotData[string]) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  // Commit the raw draft to the stored value, coercing once (not per keystroke). No-op for non-text
  // steps, so it's safe to call unconditionally before leaving any step.
  //
  // Number steps keep whatever was typed, exactly like the grid sheet: coerceSetupValue returns a
  // number when the text parses as one and the raw string otherwise. Real setup values that live in
  // "number" fields are often not numbers — spring codes ("2.7-blue"), ranges ("3-4"), notes — and
  // silently blanking them on commit lost the entry with no error.
  const commitDraft = useCallback(() => {
    if (!step || (step.kind !== "text" && step.kind !== "number")) return;
    setValue(step.key, coerceSetupValue(draft));
  }, [step, draft, setValue]);

  const advance = useCallback(() => {
    commitDraft();
    haptic("light");
    setIndex((i) => Math.min(i + 1, steps.length));
  }, [commitDraft, steps.length]);

  const goBack = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // ---- Review screen -------------------------------------------------------
  if (atEnd) {
    const skipped = steps.filter((s) => !isAnswered(s, values[s.key]));
    return (
      <SurfaceCard>
        <div className="space-y-4">
          <div>
            <Eyebrow>{subject}</Eyebrow>
            <h2 className="page-title mt-1 text-xl">
              {answeredCount} of {steps.length} filled
            </h2>
            <p className="ui-caption mt-1 text-muted-foreground">
              {skipped.length === 0
                ? "Every parameter has a value."
                : `${skipped.length} left blank — you can fill them any time on the setup sheet.`}
            </p>
          </div>

          {skipped.length > 0 ? (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
              {skipped.slice(0, 40).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/50"
                  onClick={() => setIndex(steps.indexOf(s))}
                >
                  <span className="truncate text-sm">{s.label}</span>
                  <span className="ui-caption shrink-0 text-muted-foreground">{s.sectionTitle}</span>
                </button>
              ))}
              {skipped.length > 40 ? (
                <div className="px-3 py-2 text-center ui-caption text-muted-foreground">
                  +{skipped.length - 40} more
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2.5 text-sm"
              onClick={goBack}
              disabled={saving}
            >
              Back
            </button>
            <button
              type="button"
              className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              onClick={() => onSave(values)}
              disabled={saving}
            >
              {saving ? "Saving…" : saveLabel}
            </button>
          </div>
        </div>
      </SurfaceCard>
    );
  }

  if (!step) {
    return (
      <SurfaceCard>
        <p className="text-sm text-muted-foreground">
          This car&apos;s setup sheet has no parameters yet.
        </p>
        <button type="button" className="mt-3 text-sm underline" onClick={onCancel}>
          Back
        </button>
      </SurfaceCard>
    );
  }

  const current = values[step.key];
  const multiSelected = step.kind === "multiChoice" ? readMulti(current) : [];

  return (
    <SurfaceCard>
      <div className="space-y-4">
        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="text-left"
              onClick={() => setShowSections((v) => !v)}
              aria-expanded={showSections}
            >
              <Eyebrow>{step.sectionTitle}</Eyebrow>
            </button>
            <span className="font-mono text-[11px] text-muted-foreground">
              {index + 1}/{steps.length}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${((index + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>

        {showSections ? (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-secondary/60 p-2">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                className={cn(
                  chipToggleClass(s.id === step.sectionId),
                  "px-2.5 py-1 text-[11px]"
                )}
                onClick={() => {
                  setIndex(s.firstStepIndex);
                  setShowSections(false);
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        ) : null}

        {/* The question */}
        <div>
          <h2 className="page-title text-xl leading-tight">{step.label}</h2>
          <p className="ui-caption mt-1 text-muted-foreground">
            {step.sectionTitle} · {step.indexInSection} of {step.sectionSize}
            {step.unit ? ` · ${step.unit}` : ""}
          </p>
        </div>

        {/* The control */}
        {step.kind === "text" || step.kind === "number" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              advance();
            }}
          >
            <input
              ref={textRef}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-3 text-lg outline-none focus:border-foreground/40"
              inputMode={step.kind === "number" ? "decimal" : "text"}
              enterKeyHint="next"
              placeholder="—"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
            />
          </form>
        ) : null}

        {step.kind === "boolean" ? (
          <div className="flex gap-2">
            {/*
              Same stored tokens the grid sheet uses: "1" is true, anything else false
              (getBoolFromSetupString). "0" rather than "" for No, so a deliberate No is
              distinguishable from never-answered on the review screen.
            */}
            {[
              { label: "Yes", token: "1" },
              { label: "No", token: "0" },
            ].map((opt) => (
              <button
                key={opt.label}
                type="button"
                className={cn(
                  chipToggleClass(String(current ?? "") === opt.token),
                  "flex-1 px-3 py-3 text-sm"
                )}
                onClick={() => {
                  setValue(step.key, opt.token);
                  advance();
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}

        {step.kind === "choice" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(step.options ?? []).map((label, i) => {
              const token = tokenFor(step, i);
              const active = current != null && String(current) === token;
              return (
                <button
                  key={`${label}-${i}`}
                  type="button"
                  className={cn(chipToggleClass(active), "px-3 py-3 text-sm")}
                  onClick={() => {
                    // Tapping the selected option clears it — the only way to un-answer a choice.
                    setValue(step.key, active ? "" : token);
                    if (!active) advance();
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

        {step.kind === "multiChoice" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(step.options ?? []).map((label, i) => {
              const token = tokenFor(step, i);
              const active = multiSelected.includes(token);
              return (
                <button
                  key={`${label}-${i}`}
                  type="button"
                  className={cn(chipToggleClass(active), "px-3 py-3 text-sm")}
                  onClick={() => {
                    haptic("light");
                    const next = active
                      ? multiSelected.filter((t) => t !== token)
                      : [...multiSelected, token];
                    setValue(step.key, next);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2.5 text-sm disabled:opacity-40"
            onClick={goBack}
            disabled={index === 0}
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground"
            onClick={advance}
          >
            Skip
          </button>
          <button
            type="button"
            className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            onClick={advance}
          >
            {index === steps.length - 1 ? "Done" : "Next"}
          </button>
        </div>

        <button
          type="button"
          className="w-full text-center ui-caption text-muted-foreground underline"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </SurfaceCard>
  );
}
