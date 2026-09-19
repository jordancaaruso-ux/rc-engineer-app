"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { SetupFillDraftResumeCard } from "@/components/setup/SetupFillDraftResumeCard";
import {
  useSetupFillAutosave,
  useSetupFillDraft,
  type SetupFillDraftBinding,
} from "@/components/setup/useSetupFillDraft";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Name it, choose a starting point, then fill it in.
 *
 * Kept as two explicit steps rather than dropping straight into the questions: the starting point
 * is the single biggest lever on how long the fill takes, and it can't be changed halfway through.
 *
 * ONE surface, whichever starting point you pick (founder call 2026-09-03). Starting empty used to
 * open a sequential one-question-per-screen flow, on the argument that 40-70 unseen values need
 * rhythm more than they need an overview. Two things killed it. A chassis that draws its own sheet
 * never came here at all, so the flow only ever ran for chassis with no paper — where the generic
 * template is 43 fields in five sections, not the 150 it was designed for. And the log-run wizard
 * fills that same template from scratch on the grid, so the same driver entering the same values
 * met two different surfaces depending on which door they used.
 *
 * The autosave the sequential flow carried is kept and moved onto the grid, because the failure it
 * existed for is unchanged: a long first fill lost whole to a back-swipe or a phone lock.
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

  if (started) {
    return (
      <NewSetupSheetFill
        template={template}
        initialValues={resumed && parkedDraft ? parkedDraft.values : startValues}
        subject={name.trim() || carName}
        /*
         * Drafts are for the from-scratch fill only. Copying a previous setup or a baseline lands
         * a full sheet of values in one tap, and parking that would clobber a real half-finished
         * fill — the draft's natural key is (user, car), so there is nowhere else for it to go.
         */
        fillDraft={mode === "empty" ? draftBinding : undefined}
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
          className="w-full rounded-lg primary-face bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
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
          Open the sheet
        </button>
      </div>
      </SurfaceCard>
    </div>
  );
}

/**
 * The whole sheet at once. Same grid the editor uses, so there is one thing to learn — but this one
 * isn't written until you say so, because the setup doesn't exist yet.
 *
 * Given `fillDraft`, what has been typed is also parked on the server as you go. It is a pill and
 * never a blocker: a driver mid-sheet is still filling it in, and the save at the end is the one
 * that counts.
 */
function NewSetupSheetFill({
  template,
  initialValues,
  subject,
  saving,
  error,
  fillDraft,
  onSave,
  onCancel,
}: {
  template: SetupSheetTemplate;
  initialValues: SetupSnapshotData;
  subject: string;
  saving: boolean;
  error: string | null;
  /** Omit and nothing is parked until the final save. */
  fillDraft?: SetupFillDraftBinding;
  onSave: (values: SetupSnapshotData) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const { state: draftState, report } = useSetupFillAutosave(fillDraft, template);

  const onChange = useCallback(
    (next: SetupSnapshotData) => {
      setValues(next);
      report?.(next);
    },
    [report]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>{subject}</Eyebrow>
        <div className="flex items-center gap-3">
          {fillDraft && draftState !== "idle" ? (
            <span className="ui-caption text-muted-foreground">
              {draftState === "saving" ? "Saving…" : draftState === "saved" ? "Saved" : "Not saved"}
            </span>
          ) : null}
          <button
            type="button"
            className="ui-caption text-muted-foreground underline"
            onClick={onCancel}
            disabled={saving}
          >
            Back
          </button>
        </div>
      </div>

      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        onChange={onChange}
      />

      {error ? <p className="ui-caption text-destructive">{error}</p> : null}

      <button
        type="button"
        className="w-full rounded-lg primary-face bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        onClick={() => onSave(values)}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save setup"}
      </button>
    </div>
  );
}
