"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Eyebrow } from "@/components/ui/panel";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import {
  buildSetupFillSteps,
  countAnsweredSetupFillSteps,
  isSetupFillStepAnswered,
  readSetupFillMultiValue,
  setupFillSections,
  type SetupFillStep,
} from "@/lib/setup/setupFillOrder";
import { ExitPromptSheet } from "@/components/ui/ExitPromptSheet";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { clampStepIndex, resumePendingText } from "@/lib/setup/setupFillDraft";
import type { SetupFillDraftBinding } from "@/components/setup/useSetupFillDraft";
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
 *
 * Given `fillDraft`, answers are also parked on the server as you go (2026-08-02), because a flow
 * built for one long sitting was previously losing all of it to a cancel, a back-swipe or a phone
 * lock. The autosave is held to the same rhythm rule as everything else here: it must never block,
 * never interrupt, and never move anything on screen.
 */

const SAVE_DEBOUNCE_MS = 800;

type SaveStatus = "idle" | "saving" | "saved" | "error";

type Props = {
  template: SetupSheetTemplate;
  /** Pre-filled starting values (kit setup, last setup, or {}). */
  initialValues: SetupSnapshotData;
  /** Shown above the progress bar, e.g. "Xray X4'26". */
  subject: string;
  saveLabel?: string;
  saving?: boolean;
  error?: string | null;
  /**
   * Server-side draft wiring. Omit and nothing is persisted until the final save — which is what
   * the grid callers and any test that just wants the questions want.
   */
  fillDraft?: SetupFillDraftBinding;
  /** Resume position from a parked draft. */
  initialStepIndex?: number;
  initialPendingText?: string | null;
  initialPendingStepKey?: string | null;
  onSave: (values: SetupSnapshotData) => void;
  onCancel: () => void;
};

/** Stored token for an option label, honouring the schema's declared values. */
function tokenFor(step: SetupFillStep, index: number): string {
  return step.optionValues?.[index] ?? step.options?.[index] ?? "";
}

export function SetupFillFlow({
  template,
  initialValues,
  subject,
  saveLabel = "Save setup",
  saving = false,
  error,
  fillDraft,
  initialStepIndex,
  initialPendingText,
  initialPendingStepKey,
  onSave,
  onCancel,
}: Props) {
  const steps = useMemo(() => buildSetupFillSteps(template), [template]);
  const sections = useMemo(() => setupFillSections(steps), [steps]);
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const [index, setIndex] = useState(() => clampStepIndex(initialStepIndex ?? 0, steps.length));
  const [showSections, setShowSections] = useState(false);
  // Raw string the user is typing into a text/number step. Kept separate from the stored value so
  // an in-progress decimal ("3.") survives keystrokes — coercing on every change turned 3.2 into 32.
  const [pendingText, setPendingText] = useState(
    () =>
      resumePendingText(
        { text: initialPendingText, stepKey: initialPendingStepKey },
        steps[clampStepIndex(initialStepIndex ?? 0, steps.length)]
      ) ?? ""
  );
  const textRef = useRef<HTMLInputElement | null>(null);
  // Consumed by the first run of the reseed effect below, which would otherwise immediately
  // overwrite resumed half-typed text with whatever was last committed to that field.
  const resumeSeededRef = useRef(pendingText !== "");

  const step = steps[index];
  const atEnd = index >= steps.length;

  // On arrival at a text/number step, seed the pending text from the stored value and focus so
  // typing can start immediately (choice steps are taps). Reseed only on step change, never on
  // commit, so a committed value doesn't wipe what you're typing.
  useEffect(() => {
    if (step && (step.kind === "text" || step.kind === "number")) {
      if (resumeSeededRef.current) {
        resumeSeededRef.current = false;
        textRef.current?.focus();
        return;
      }
      const stored = values[step.key];
      setPendingText(stored == null ? "" : String(stored));
      textRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed on step change only, not `values`
  }, [index, step]);

  const answeredCount = useMemo(
    () => countAnsweredSetupFillSteps(steps, values),
    [steps, values]
  );

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [exitOpen, setExitOpen] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  // Skips the save the very first render would otherwise fire — same role as the grid editor's
  // `dirty` ref. Only real input arms the autosave.
  const touched = useRef(false);
  // Set once we start promoting to a real setup, so a late autosave can't resurrect the row the
  // server deleted in the same transaction.
  const promoting = useRef(false);
  // The PUT currently in flight, awaited before promotion so nothing lands after that delete.
  const inFlight = useRef<Promise<void> | null>(null);

  const setValue = useCallback((key: string, next: SetupSnapshotData[string]) => {
    touched.current = true;
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  // Values as they would be once the in-flight text is committed. `commitPendingText` is a setState,
  // so the `values` a handler sees in the same tick hasn't caught up — the review screen never
  // noticed because you always advance past the last step first, but "Save & exit" is reachable
  // mid-question and would otherwise drop whatever is still in the box.
  //
  // Number steps keep whatever was typed, exactly like the grid sheet: coerceSetupValue returns a
  // number when the text parses as one and the raw string otherwise. Real setup values that live in
  // "number" fields are often not numbers — spring codes ("2.7-blue"), ranges ("3-4"), notes — and
  // silently blanking them on commit lost the entry with no error.
  const valuesWithPendingText = useCallback((): SetupSnapshotData => {
    if (!step || (step.kind !== "text" && step.kind !== "number")) return values;
    return { ...values, [step.key]: coerceSetupValue(pendingText) };
  }, [step, pendingText, values]);

  // Commit the raw text to the stored value, coercing once (not per keystroke). No-op for non-text
  // steps, so it's safe to call unconditionally before leaving any step.
  const commitPendingText = useCallback(() => {
    if (!step || (step.kind !== "text" && step.kind !== "number")) return;
    setValue(step.key, coerceSetupValue(pendingText));
  }, [step, pendingText, setValue]);

  const advance = useCallback(() => {
    commitPendingText();
    haptic("light");
    // Moving is progress even when the step was skipped — the parked draft should resume where you
    // actually got to, not at the last question you happened to answer.
    touched.current = true;
    setIndex((i) => Math.min(i + 1, steps.length));
  }, [commitPendingText, steps.length]);

  const goBack = useCallback(() => {
    touched.current = true;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // ---- Draft autosave ------------------------------------------------------

  const persistDraft = useCallback(async () => {
    if (!fillDraft || promoting.current) return;
    setSaveStatus("saving");
    const isTextStep = Boolean(step && (step.kind === "text" || step.kind === "number"));
    const p = fillDraft
      .save({
        values: valuesWithPendingText(),
        stepIndex: index,
        // Half-typed text is part of the draft on purpose: `commitPendingText` only fires on
        // advance or blur, so a phone-lock mid-question would otherwise resume onto an empty box
        // — which reads as the app eating your input even though nothing was ever committed.
        pendingText: isTextStep && pendingText ? pendingText : null,
        pendingStepKey: isTextStep && pendingText ? (step?.key ?? null) : null,
        answeredCount,
        stepCount: steps.length,
      })
      .then(() => setSaveStatus("saved"))
      .catch(() => setSaveStatus("error"));
    inFlight.current = p;
    await p;
    inFlight.current = null;
  }, [fillDraft, valuesWithPendingText, index, step, pendingText, answeredCount, steps.length]);

  useEffect(() => {
    if (!fillDraft || !touched.current || promoting.current) return;
    // The one gate, shared with the exit prompt: nothing answered means nothing worth a row, and
    // the resume card must never be able to offer "0 of 68 filled".
    if (answeredCount === 0) return;
    const t = window.setTimeout(() => void persistDraft(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [fillDraft, values, index, pendingText, answeredCount, persistDraft]);

  /**
   * Flush when the app is backgrounded. `beforeunload` is unreliable in the Capacitor WebView, and
   * a phone locking mid-question is precisely the case this feature exists for — `keepalive` on
   * the PUT lets the request outlive the page.
   */
  useEffect(() => {
    if (!fillDraft) return;
    const flush = () => {
      if (!touched.current || promoting.current || answeredCount === 0) return;
      if (document.visibilityState === "hidden") void persistDraft();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [fillDraft, persistDraft, answeredCount]);

  /** Promote to a real setup. Drains any in-flight draft write first (see `promoting`). */
  const saveAndExit = useCallback(async () => {
    if (saving) return;
    const next = valuesWithPendingText();
    promoting.current = true;
    if (inFlight.current) await inFlight.current.catch(() => {});
    onSave(next);
  }, [saving, valuesWithPendingText, onSave]);

  const requestExit = useCallback(() => {
    if (saving) return;
    // Founder call: only ask once there is something to lose. A fill abandoned at question one
    // just leaves.
    if (!fillDraft || answeredCount === 0) {
      onCancel();
      return;
    }
    setExitOpen(true);
  }, [saving, fillDraft, answeredCount, onCancel]);

  const exitSavingDraft = useCallback(async () => {
    setExitBusy(true);
    try {
      await persistDraft();
      // Never navigate away claiming a save that didn't land — this is the one place the pill's
      // quiet "Not saved" isn't enough.
      if (inFlight.current) await inFlight.current;
      onCancel();
    } finally {
      setExitBusy(false);
    }
  }, [persistDraft, onCancel]);

  const exitDiscarding = useCallback(async () => {
    setExitBusy(true);
    promoting.current = true; // stop the debounce from writing the row straight back
    try {
      await fillDraft?.discard();
    } catch {
      // A draft we couldn't delete is recoverable noise — the user asked to leave, so let them.
    } finally {
      setExitBusy(false);
      onCancel();
    }
  }, [fillDraft, onCancel]);

  const exitPrompt = (
    <ExitPromptSheet
      open={exitOpen}
      title="Leave this fill?"
      detail={
        saveStatus === "error"
          ? "The last few answers haven't reached the server yet."
          : `Your ${answeredCount} answers are saved — pick this up any time from the car page.`
      }
      saveLabel={exitBusy ? "Saving…" : "Save draft & exit"}
      discardLabel={`Discard — delete these ${answeredCount} answers`}
      stayLabel="Keep filling"
      busy={exitBusy}
      onSave={() => void exitSavingDraft()}
      onDiscard={() => void exitDiscarding()}
      onStay={() => setExitOpen(false)}
    />
  );

  // ---- Review screen -------------------------------------------------------
  if (atEnd) {
    const skipped = steps.filter((s) => !isSetupFillStepAnswered(s, values[s.key]));
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
              onClick={() => void saveAndExit()}
              disabled={saving}
            >
              {saving ? "Saving…" : saveLabel}
            </button>
          </div>
        </div>
        {exitPrompt}
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
  const multiSelected = step.kind === "multiChoice" ? readSetupFillMultiValue(current) : [];

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
            {/*
              Draft status lives at the far end of a row that is already justify-between, so it can
              appear and disappear without nudging the section chip or the question below it.
            */}
            <div className="flex shrink-0 items-center gap-2">
              {saveStatus === "saving" ? (
                <span className="ui-caption text-muted-foreground">Saving…</span>
              ) : saveStatus === "saved" ? (
                <span className="ui-caption text-muted-foreground">Saved</span>
              ) : saveStatus === "error" ? (
                <span className="ui-caption text-destructive">Not saved</span>
              ) : null}
              <span className="font-mono text-[11px] text-muted-foreground">
                {index + 1}/{steps.length}
              </span>
            </div>
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
              value={pendingText}
              onChange={(e) => {
                touched.current = true;
                setPendingText(e.target.value);
              }}
              onBlur={commitPendingText}
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
          <div data-testid="fill-choice-options" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
          <div data-testid="fill-multichoice-options" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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

        {/*
          The two ways out, kept off the Back/Skip/Next row: a fourth button there would shrink the
          primary target to a third of a phone-width row, and that target is the most-tapped thing
          in the app during a fill.

          "Save & exit" is the same promotion the review screen's button does — one save path, one
          error state — just reachable from any question. Hidden until something is answered, which
          also keeps the admin baseline endpoint's "needs at least one value" rule unreachable.
        */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          {fillDraft && answeredCount > 0 ? (
            <button
              type="button"
              className={outlineButtonClassName("px-3 py-2")}
              onClick={() => void saveAndExit()}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save & exit"}
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="ui-caption text-muted-foreground underline"
            onClick={requestExit}
          >
            Cancel
          </button>
        </div>
      </div>
      {exitPrompt}
    </SurfaceCard>
  );
}
