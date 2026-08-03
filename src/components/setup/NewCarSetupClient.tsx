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

/**
 * Name it, choose a starting point, then fill it in.
 *
 * Kept as two explicit steps rather than dropping straight into the questions: the starting point
 * is the single biggest lever on how long the fill takes, and it can't be changed halfway through.
 *
 * The starting point also picks the surface (2026-07-29). A blank sheet gets the sequential
 * one-question-at-a-time flow, which is the only way to fill 40-70 values you've never seen. A
 * baseline or previous setup gets the grid instead: you're changing a handful of values against a
 * sheet that's already right, and stepping past 60 correct answers to reach them is the whole
 * complaint.
 *
 * "Start from a previous setup" leads and carries a dropdown (founder call 2026-07-29). Adjusting
 * the setup you're already on is the common case, it was previously locked to whichever row was
 * newest, and a driver reaching for "the one from the club meeting" had no way to say so.
 */

type StartMode = "previous" | "baseline" | "empty";

export type PreviousSetupOption = {
  id: string;
  /** Saved-setup name, or the run/sheet it came from. */
  label: string;
  kind: "saved" | "run" | "sheet";
  dateLabel: string;
  data: SetupSnapshotData;
};

/** A global baseline published against this car's chassis type. */
export type BaselineStartChoice = {
  id: string;
  label: string;
  kindLabel: string;
  contextLabel: string | null;
  data: SetupSnapshotData;
};

/** A sequential fill this driver parked on this car, counts recomputed against today's template. */
export type SetupFillDraftResume = {
  values: SetupSnapshotData;
  stepIndex: number;
  pendingText: string | null;
  pendingStepKey: string | null;
  name: string | null;
  answeredCount: number;
  stepCount: number;
  updatedAt: string;
};

const KIND_LABEL: Record<PreviousSetupOption["kind"], string> = {
  saved: "Saved",
  run: "From a run",
  sheet: "From a sheet",
};

export function NewCarSetupClient({
  carId,
  carName,
  template,
  baselines,
  previousSetups,
  fillDraft: parkedDraft = null,
}: {
  carId: string;
  carName: string;
  template: SetupSheetTemplate;
  /** Global baselines for this car's chassis, kit first. Empty when the chassis has none. */
  baselines: BaselineStartChoice[];
  /** This car's recent snapshots, newest first — saved setups, run setups and imported sheets. */
  previousSetups: PreviousSetupOption[];
  /** A sequential fill parked on this car, if there is one. */
  fillDraft?: SetupFillDraftResume | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(parkedDraft?.name ?? "");
  const [mode, setMode] = useState<StartMode>(
    previousSetups.length > 0 ? "previous" : baselines.length > 0 ? "baseline" : "empty"
  );
  const [previousId, setPreviousId] = useState<string>(previousSetups[0]?.id ?? "");
  const [baselineId, setBaselineId] = useState<string>(baselines[0]?.id ?? "");
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether this fill picked up the parked draft. Only then do the resume props apply — pressing
  // "Start filling" fresh must begin at question one with an empty sheet.
  const [resumed, setResumed] = useState(false);
  const [clearingDraft, setClearingDraft] = useState(false);

  const draftBinding = useSetupFillDraft(
    { carId },
    { name: name.trim() || null, templateId: template.id }
  );

  /** Throw away the parked draft, then re-read so the card goes with it. */
  const discardParkedDraft = async () => {
    setClearingDraft(true);
    try {
      await draftBinding?.discard();
      router.refresh();
    } finally {
      setClearingDraft(false);
    }
  };

  const selectedPrevious =
    previousSetups.find((s) => s.id === previousId) ?? previousSetups[0] ?? null;
  const selectedBaseline = baselines.find((b) => b.id === baselineId) ?? baselines[0] ?? null;

  const startValues: SetupSnapshotData =
    mode === "baseline" && selectedBaseline
      ? selectedBaseline.data
      : mode === "previous" && selectedPrevious
        ? selectedPrevious.data
        : {};

  const save = async (values: SetupSnapshotData) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          name: name.trim() || "Untitled setup",
          data: values,
          // Clear the parked fill in the same transaction as the create, so a backgrounded app
          // can't land the setup and still leave a resume card pointing at it.
          clearFillDraft: true,
          // Audit lineage only when this really started from something.
          ...(mode === "previous" && selectedPrevious
            ? { baseSetupSnapshotId: selectedPrevious.id }
            : {}),
          ...(mode === "baseline" && selectedBaseline
            ? { fromBaselineId: selectedBaseline.id }
            : {}),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save this setup.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      router.push(`/cars/${carId}/setups/${body.setup.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this setup.");
      setSaving(false);
    }
  };

  if (started && mode === "empty") {
    return (
      <SetupFillFlow
        template={template}
        initialValues={resumed && parkedDraft ? parkedDraft.values : startValues}
        initialStepIndex={resumed ? parkedDraft?.stepIndex : undefined}
        initialPendingText={resumed ? parkedDraft?.pendingText : null}
        initialPendingStepKey={resumed ? parkedDraft?.pendingStepKey : null}
        fillDraft={draftBinding}
        subject={name.trim() || carName}
        saving={saving}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={() => {
          setStarted(false);
          setResumed(false);
          // The draft may have just been saved or discarded; re-read so the card matches.
          router.refresh();
        }}
      />
    );
  }

  if (started) {
    return (
      <NewSetupSheetFill
        template={template}
        initialValues={startValues}
        subject={name.trim() || carName}
        saving={saving}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={() => setStarted(false)}
      />
    );
  }

  const options: Array<{ mode: StartMode; title: string; detail: string; available: boolean }> = [
    {
      mode: "previous",
      title: "Start from a previous setup",
      detail: selectedPrevious
        ? "Copies an existing setup on this car — change only what you're trying."
        : "This car has no setups or logged runs yet.",
      available: previousSetups.length > 0,
    },
    {
      mode: "baseline",
      title: "Start from a baseline setup",
      detail: selectedBaseline
        ? "A published sheet for this chassis — kit, or someone's proven setup."
        : "No baselines have been published for this chassis yet.",
      available: baselines.length > 0,
    },
    {
      mode: "empty",
      title: "Start empty",
      detail: "Enter every value yourself.",
      available: true,
    },
  ];

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
        <div>
          <Eyebrow>{carName}</Eyebrow>
          <label className="mt-2 block">
            <span className="ui-label-meta text-muted-foreground">Setup name</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-secondary px-3 py-2.5 text-base outline-none focus:border-foreground/40"
              placeholder="High grip carpet"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>

        <div className="space-y-2">
          <Eyebrow>Start from</Eyebrow>
          {options.map((opt) => (
            <div
              key={opt.mode}
              className={cn(
                "rounded-lg border transition",
                mode === opt.mode && opt.available
                  ? "border-foreground/50 bg-muted"
                  : "border-border bg-secondary",
                !opt.available && "opacity-50"
              )}
            >
              <button
                type="button"
                disabled={!opt.available}
                onClick={() => setMode(opt.mode)}
                className="block w-full px-3 py-3 text-left"
              >
                <div className="text-sm text-foreground">{opt.title}</div>
                <div className="ui-caption mt-0.5 text-muted-foreground">{opt.detail}</div>
              </button>

              {opt.mode === "previous" && opt.available && mode === "previous" ? (
                <div className="px-3 pb-3">
                  <label className="block">
                    <span className="ui-label-meta text-muted-foreground">Which setup</span>
                    <select
                      value={selectedPrevious?.id ?? ""}
                      onChange={(e) => setPreviousId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/40"
                    >
                      {previousSetups.map((s, i) => (
                        <option key={s.id} value={s.id}>
                          {`${i === 0 ? "Latest · " : ""}${s.label} · ${s.dateLabel}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedPrevious ? (
                    <p className="ui-caption mt-1.5 text-muted-foreground">
                      {KIND_LABEL[selectedPrevious.kind]} · {selectedPrevious.dateLabel}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {opt.mode === "baseline" && opt.available && mode === "baseline" ? (
                <div className="px-3 pb-3">
                  <label className="block">
                    <span className="ui-label-meta text-muted-foreground">Which baseline</span>
                    <select
                      value={selectedBaseline?.id ?? ""}
                      onChange={(e) => setBaselineId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none focus:border-foreground/40"
                    >
                      {baselines.map((b) => (
                        <option key={b.id} value={b.id}>
                          {`${b.kindLabel} · ${b.label}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedBaseline?.contextLabel ? (
                    <p className="ui-caption mt-1.5 text-muted-foreground">
                      {selectedBaseline.contextLabel}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <button
          type="button"
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
          onClick={() => {
            /*
             * Starting a fresh empty fill overwrites the parked draft on the first autosave — the
             * row's natural key is (user, car), so there is nowhere else for it to go. Ask rather
             * than clobber; Resume on the card above is the other door.
             */
            if (
              mode === "empty" &&
              parkedDraft &&
              !window.confirm(
                `Start over? The draft with ${parkedDraft.answeredCount} answers is deleted.`
              )
            ) {
              return;
            }
            setResumed(false);
            setStarted(true);
          }}
        >
          {mode === "empty" ? "Start filling" : "Open the sheet"}
        </button>
      </div>
      </SurfaceCard>
    </div>
  );
}

/**
 * Whole sheet at once, for a setup that starts from values that are already mostly right. Same
 * grid the editor uses, so there is one thing to learn — but this one isn't saved until you say so,
 * because the setup doesn't exist yet.
 */
function NewSetupSheetFill({
  template,
  initialValues,
  subject,
  saving,
  error,
  onSave,
  onCancel,
}: {
  template: SetupSheetTemplate;
  initialValues: SetupSnapshotData;
  subject: string;
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

      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        onChange={setValues}
      />

      {error ? <p className="ui-caption text-destructive">{error}</p> : null}

      <button
        type="button"
        className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        onClick={() => onSave(values)}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save setup"}
      </button>
    </div>
  );
}
