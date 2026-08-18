"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { SetupFillFlow } from "@/components/setup/SetupFillFlow";
import { SetupFillDraftResumeCard } from "@/components/setup/SetupFillDraftResumeCard";
import { useSetupFillDraft } from "@/components/setup/useSetupFillDraft";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";
import {
  BASELINE_GRIP_LEVELS,
  BASELINE_KIND_HINT,
  BASELINE_KIND_LABEL,
  BASELINE_SETUP_KINDS,
  BASELINE_SURFACES,
  MAX_BASELINE_NAME_LENGTH,
  MAX_BASELINE_NOTES_LENGTH,
  type BaselineSetupKindValue,
} from "@/lib/baselineSetups/baselineSetupShape";

/**
 * Admin authoring for a global baseline setup — details first, then the values.
 *
 * Same two-step shape drivers get in `NewCarSetupClient`, and for the same reason: the starting
 * point decides how long the fill takes and can't be changed halfway through. A blank baseline gets
 * the sequential one-question flow (the only sane way to enter 70 values); starting from an
 * existing baseline gets the grid, because a pro sheet is usually kit with fifteen changes.
 */

export type BaselineStartOption = {
  id: string;
  name: string;
  kind: BaselineSetupKindValue;
  data: SetupSnapshotData;
};

type Mode = "existing" | "empty";

/** A sequential fill this admin parked on this chassis, counts recomputed against the template. */
export type BaselineFillDraftResume = {
  values: SetupSnapshotData;
  stepIndex: number;
  pendingText: string | null;
  pendingStepKey: string | null;
  name: string | null;
  answeredCount: number;
  stepCount: number;
  updatedAt: string;
};

export function BaselineSetupEditorClient({
  modelId,
  modelName,
  template,
  baselineId,
  initial,
  startOptions,
  fillDraft: parkedDraft = null,
}: {
  modelId: string;
  modelName: string;
  template: SetupSheetTemplate;
  /** Set when editing an existing baseline; null when publishing a new one. */
  baselineId?: string | null;
  initial?: {
    name: string;
    kind: BaselineSetupKindValue;
    notes: string;
    surface: string;
    gripLevel: string;
    data: SetupSnapshotData;
  };
  /** Other baselines on this chassis, offered as starting points when creating. */
  startOptions: BaselineStartOption[];
  /** A sequential fill parked on this chassis. Never set on the edit path — see below. */
  fillDraft?: BaselineFillDraftResume | null;
}) {
  const router = useRouter();
  const isEdit = Boolean(baselineId);

  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<BaselineSetupKindValue>(initial?.kind ?? "PRO");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [surface, setSurface] = useState(initial?.surface ?? "");
  const [gripLevel, setGripLevel] = useState(initial?.gripLevel ?? "");
  const [mode, setMode] = useState<Mode>(startOptions.length > 0 ? "existing" : "empty");
  const [startFromId, setStartFromId] = useState(startOptions[0]?.id ?? "");
  // Details first in both modes — editing a baseline's name or tags shouldn't mean walking the sheet.
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const [clearingDraft, setClearingDraft] = useState(false);

  /*
   * Drafts only exist on the create-from-empty path — the edit path already has a real row, and
   * `SetupFillFlow` is never mounted there (see the `started && !isEdit && mode === "empty"`
   * branch below). Passing null disables the whole thing at the hook.
   */
  const draftBinding = useSetupFillDraft(isEdit ? null : { setupSheetModelId: modelId }, {
    name: name.trim() || null,
    templateId: template.id,
  });

  const discardParkedDraft = async () => {
    setClearingDraft(true);
    try {
      await draftBinding?.discard();
      router.refresh();
    } finally {
      setClearingDraft(false);
    }
  };

  const backHref = `/setup-sheet-models/${modelId}`;
  const selectedStart = startOptions.find((o) => o.id === startFromId) ?? startOptions[0] ?? null;
  const startValues: SetupSnapshotData = isEdit
    ? (initial?.data ?? {})
    : mode === "existing" && selectedStart
      ? selectedStart.data
      : {};

  const save = async (values: SetupSnapshotData) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give this baseline a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: trimmed,
        kind,
        notes: notes.trim() || null,
        surface: surface || null,
        gripLevel: gripLevel || null,
        data: values,
        // Only the create route knows this field; the PATCH path has no draft to clear anyway.
        ...(isEdit ? {} : { clearFillDraft: true }),
      };
      const res = await fetch(
        isEdit ? `/api/baseline-setups/${baselineId}` : `/api/setup-sheet-models/${modelId}/baselines`,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save this baseline.");
      }
      router.push(backHref);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this baseline.");
      setSaving(false);
    }
  };

  if (started && !isEdit && mode === "empty") {
    return (
      <SetupFillFlow
        template={template}
        initialValues={resumed && parkedDraft ? parkedDraft.values : startValues}
        initialStepIndex={resumed ? parkedDraft?.stepIndex : undefined}
        initialPendingText={resumed ? parkedDraft?.pendingText : null}
        initialPendingStepKey={resumed ? parkedDraft?.pendingStepKey : null}
        fillDraft={draftBinding}
        subject={name.trim() || modelName}
        saveLabel="Publish baseline"
        saving={saving}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={() => {
          setStarted(false);
          setResumed(false);
          router.refresh();
        }}
      />
    );
  }

  if (started) {
    return (
      <BaselineSheetFill
        template={template}
        initialValues={startValues}
        subject={name.trim() || modelName}
        saveLabel={isEdit ? "Save baseline" : "Publish baseline"}
        saving={saving}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={() => (isEdit ? router.push(backHref) : setStarted(false))}
      />
    );
  }

  return (
    <div className="space-y-3">
      {parkedDraft ? (
        <SetupFillDraftResumeCard
          answeredCount={parkedDraft.answeredCount}
          stepCount={parkedDraft.stepCount}
          updatedAt={parkedDraft.updatedAt}
          busy={clearingDraft}
          onResume={() => {
            setName(parkedDraft.name ?? "");
            setMode("empty");
            setResumed(true);
            setStarted(true);
          }}
          onStartOver={() => {
            if (
              !window.confirm(
                `Start over? The draft with ${parkedDraft.answeredCount} answers is deleted.`
              )
            ) {
              return;
            }
            void discardParkedDraft();
          }}
        />
      ) : null}

      <SurfaceCard>
      <div className="space-y-5">
        <div className="space-y-3">
          <Eyebrow>{modelName}</Eyebrow>
          <label className="block">
            <span className="ui-label-meta text-muted-foreground">Name</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-base outline-none focus:border-foreground/40"
              placeholder="Kit setup"
              value={name}
              maxLength={MAX_BASELINE_NAME_LENGTH}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <div>
            <span className="ui-label-meta text-muted-foreground">Kind</span>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {BASELINE_SETUP_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm transition",
                    kind === k
                      ? "border-foreground/50 bg-muted text-foreground"
                      : "border-border bg-secondary text-muted-foreground"
                  )}
                >
                  {BASELINE_KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <p className="ui-caption mt-1.5 text-muted-foreground">{BASELINE_KIND_HINT[kind]}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="ui-label-meta text-muted-foreground">Surface</span>
              <select
                value={surface}
                onChange={(e) => setSurface(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
              >
                <option value="">Any</option>
                {BASELINE_SURFACES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="ui-label-meta text-muted-foreground">Grip</span>
              <select
                value={gripLevel}
                onChange={(e) => setGripLevel(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
              >
                <option value="">Any</option>
                {BASELINE_GRIP_LEVELS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="ui-label-meta text-muted-foreground">Notes</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
              placeholder="Works from medium grip up; drop rear droop 0.5mm on new carpet."
              rows={3}
              value={notes}
              maxLength={MAX_BASELINE_NOTES_LENGTH}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </div>

        <div className={cn("space-y-2", isEdit && "hidden")}>
          <Eyebrow>Start from</Eyebrow>
          <div
            className={cn(
              "rounded-lg border transition",
              mode === "existing" && startOptions.length > 0
                ? "border-foreground/50 bg-muted"
                : "border-border bg-secondary",
              startOptions.length === 0 && "opacity-50"
            )}
          >
            <button
              type="button"
              disabled={startOptions.length === 0}
              onClick={() => setMode("existing")}
              className="block w-full px-3 py-3 text-left"
            >
              <div className="text-sm text-foreground">An existing baseline</div>
              <div className="ui-caption mt-0.5 text-muted-foreground">
                {startOptions.length > 0
                  ? "Copies its values — change only what this sheet does differently."
                  : "This chassis has no baselines yet."}
              </div>
            </button>
            {mode === "existing" && startOptions.length > 0 ? (
              <div className="px-3 pb-3">
                <select
                  value={selectedStart?.id ?? ""}
                  onChange={(e) => setStartFromId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
                >
                  {startOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {`${BASELINE_KIND_LABEL[o.kind]} · ${o.name}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>

          <div
            className={cn(
              "rounded-lg border transition",
              mode === "empty" ? "border-foreground/50 bg-muted" : "border-border bg-secondary"
            )}
          >
            <button
              type="button"
              onClick={() => setMode("empty")}
              className="block w-full px-3 py-3 text-left"
            >
              <div className="text-sm text-foreground">Empty</div>
              <div className="ui-caption mt-0.5 text-muted-foreground">
                One question at a time, every value entered by hand.
              </div>
            </button>
          </div>
        </div>

        {error ? <p className="ui-caption text-destructive">{error}</p> : null}

        <button
          type="button"
          className="w-full rounded-lg primary-face bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          onClick={() => {
            if (!name.trim()) {
              setError("Give this baseline a name.");
              return;
            }
            // A fresh empty fill overwrites the parked draft on the first autosave — the row's
            // natural key is (admin, chassis). Ask rather than clobber.
            if (
              !isEdit &&
              mode === "empty" &&
              parkedDraft &&
              !window.confirm(
                `Start over? The draft with ${parkedDraft.answeredCount} answers is deleted.`
              )
            ) {
              return;
            }
            setError(null);
            setResumed(false);
            setStarted(true);
          }}
        >
          {!isEdit && mode === "empty" ? "Start filling" : "Open the sheet"}
        </button>
      </div>
      </SurfaceCard>
    </div>
  );
}

/** Whole sheet at once — for values that are already mostly right. Nothing saves until you say so. */
function BaselineSheetFill({
  template,
  initialValues,
  subject,
  saveLabel,
  saving,
  error,
  onSave,
  onCancel,
}: {
  template: SetupSheetTemplate;
  initialValues: SetupSnapshotData;
  subject: string;
  saveLabel: string;
  saving: boolean;
  error: string | null;
  onSave: (values: SetupSnapshotData) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{subject}</Eyebrow>
        <button
          type="button"
          className="ui-caption text-muted-foreground underline"
          onClick={onCancel}
          disabled={saving}
        >
          Back
        </button>
      </div>

      <SetupSheetView value={values} template={template} enableFieldSearch onChange={setValues} />

      {error ? <p className="ui-caption text-destructive">{error}</p> : null}

      <button
        type="button"
        className="w-full rounded-lg primary-face bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        onClick={() => onSave(values)}
        disabled={saving}
      >
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
