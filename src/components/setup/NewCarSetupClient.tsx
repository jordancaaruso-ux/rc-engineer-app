"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { Eyebrow } from "@/components/ui/panel";
import { SetupFillFlow } from "@/components/setup/SetupFillFlow";
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
 * kit or previous setup gets the grid instead: you're changing a handful of values against a sheet
 * that's already right, and stepping past 60 correct answers to reach them is the whole complaint.
 *
 * "Start from a previous setup" leads and carries a dropdown (founder call 2026-07-29). Adjusting
 * the setup you're already on is the common case, it was previously locked to whichever row was
 * newest, and a driver reaching for "the one from the club meeting" had no way to say so.
 */

type StartMode = "previous" | "kit" | "empty";

export type PreviousSetupOption = {
  id: string;
  /** Baseline name, or the run/sheet it came from. */
  label: string;
  kind: "baseline" | "run" | "sheet";
  dateLabel: string;
  data: SetupSnapshotData;
};

const KIND_LABEL: Record<PreviousSetupOption["kind"], string> = {
  baseline: "Saved",
  run: "From a run",
  sheet: "From a sheet",
};

export function NewCarSetupClient({
  carId,
  carName,
  template,
  kitSetup,
  previousSetups,
}: {
  carId: string;
  carName: string;
  template: SetupSheetTemplate;
  kitSetup: SetupSnapshotData | null;
  /** This car's recent snapshots, newest first — baselines, run setups and imported sheets alike. */
  previousSetups: PreviousSetupOption[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<StartMode>(
    previousSetups.length > 0 ? "previous" : kitSetup ? "kit" : "empty"
  );
  const [previousId, setPreviousId] = useState<string>(previousSetups[0]?.id ?? "");
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPrevious =
    previousSetups.find((s) => s.id === previousId) ?? previousSetups[0] ?? null;

  const startValues: SetupSnapshotData =
    mode === "kit" && kitSetup
      ? kitSetup
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
          // Audit lineage only when this really started from an existing snapshot.
          ...(mode === "previous" && selectedPrevious
            ? { baseSetupSnapshotId: selectedPrevious.id }
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
        initialValues={startValues}
        subject={name.trim() || carName}
        saving={saving}
        error={error}
        onSave={(values) => void save(values)}
        onCancel={() => setStarted(false)}
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
      mode: "kit",
      title: "Start from the kit setup",
      detail: kitSetup
        ? "The manufacturer's baseline for this chassis — change only what's different."
        : "No kit setup has been entered for this chassis yet.",
      available: Boolean(kitSetup),
    },
    {
      mode: "empty",
      title: "Start empty",
      detail: "Enter every value yourself.",
      available: true,
    },
  ];

  return (
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
            </div>
          ))}
        </div>

        <button
          type="button"
          className="w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
          onClick={() => setStarted(true)}
        >
          {mode === "empty" ? "Start filling" : "Open the sheet"}
        </button>
      </div>
    </SurfaceCard>
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
