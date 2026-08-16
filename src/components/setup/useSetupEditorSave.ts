"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renameSetup } from "@/lib/setup/keepSetupClient";
import { changedSetupKeys } from "@/lib/setup/setupValuesFingerprint";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";

/**
 * The save behaviour both setup editors share — the grid one and the sheet one. They differ only in
 * how a value gets from the screen into storage; what a save *means* is identical, and used to be
 * copy-pasted between them.
 *
 * ============================== NOTHING SAVES ITSELF ==============================
 *
 * Every door here is a press (founder call, 2026-08-16). The debounced write-as-you-type that used
 * to run on the driver's own named setups is gone: it was the one place in the app where typing
 * changed a thing already on the shelf, and a setup is not a text box. `dirty` is exported so the
 * bar can say so, and it arms a `beforeunload` prompt — closing the tab mid-edit now asks.
 *
 * ============================== DIRTY IS A COMPARISON, NOT A FLAG ==============================
 *
 * It used to be a boolean armed by any call to the editor's `onChange`, mirrored out of a ref. That
 * said "unsaved changes" on a setup nobody had touched — see `setupValuesFingerprint`, which carries
 * the three ways it armed itself. Now the values as OPENED are held here and compared against the
 * values as they stand, which means:
 *
 * - opening a setup, or a re-render handing the same values back, can never read as work;
 * - putting a number back the way it was clears the bar and disarms the `beforeunload` prompt,
 *   because there is nothing left to lose;
 * - `changedCount` is free, so the bar can say how much is riding on the press.
 *
 * The baseline moves to what was written the moment a save lands, so the next edit counts from what
 * is now on the shelf rather than from what the driver first opened.
 *
 * Losing it also fixed a quieter wrong: "Save as a new setup" used to FLUSH the pending autosave
 * onto the setup being copied first, so forking a setup you had just edited wrote your changes into
 * BOTH rows. The edits belong to the copy alone.
 *
 * ============================== THE DOORS ==============================
 *
 * `saveMode` (see `setupSaveMode.ts`) names one primary and at most one secondary:
 *
 * - `inPlace`    — "Save changes" writes over the setup. Forking is the second door.
 * - `correctRun` — "Correct this run" is primary, because the driver came in from the run. The run
 *                  route writes a new snapshot and repoints the run, and we follow them to that new
 *                  row because the one they opened is no longer the run's.
 * - `fork`       — "Save as a new setup" is primary; correcting the run, when exactly one run is
 *                  named, is the quiet second door.
 *
 * A fork always records where it came from (`baseSetupSnapshotId`), so the new setup can say
 * "Edited from …" rather than appearing from nowhere. It is named without asking — the same ruling
 * that took the `window.prompt` off the All-setups bookmark (2026-08-11) — and Rename sits in the
 * bar afterwards for the drivers who care.
 */

export type SetupEditorSaveAction = {
  label: string;
  /** Present-tense word shown while it runs, e.g. "Saving…". */
  busyLabel: string;
  run: () => Promise<void>;
  /**
   * Stays filled yellow with nothing changed. Only the fork does: copying a setup exactly as it
   * stands is a real thing to want, while writing zero changes over a setup is not.
   */
  loudWhenClean?: boolean;
};

export type SetupEditorSave = {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
  /** A save is in flight; disable the buttons. */
  busy: boolean;
  /** The driver has changed something that is not yet stored. */
  dirty: boolean;
  /** How many boxes differ from the setup as it was opened. Zero whenever `dirty` is false. */
  changedCount: number;
  /** The loud button. Every mode has one. */
  primary: SetupEditorSaveAction;
  /** The quiet one beside it, when the mode has a second thing worth offering. */
  secondary: SetupEditorSaveAction | null;
  /** Renames the setup being edited. Null while a name would mean nothing (nothing saved yet). */
  rename: (() => Promise<void>) | null;
  /** One line explaining the mode, when it isn't self-evident from the buttons. */
  note: string | null;
};

export function useSetupEditorSave({
  carId,
  setupId,
  setupName,
  saveMode,
  values,
  getData,
}: {
  carId: string;
  setupId: string;
  /** Names the copy when this setup is forked, and seeds Rename. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  /**
   * The editor's values, in whatever shape it holds them — the grid's stored data, the sheet's
   * surface strings. Only ever compared against itself, so the shape is this hook's business only
   * as long as it is the SAME shape on both sides.
   */
  values: unknown;
  /** Reads the editor's current values in the shape storage wants. Changes with `values`. */
  getData: () => Record<string, unknown>;
}): SetupEditorSave {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * The setup as it was opened, and what everything on screen is measured against. State, not a ref:
   * a save moves it, and the bar has to repaint when it does.
   */
  const [baseline, setBaseline] = useState(values);
  const changedCount = useMemo(() => changedSetupKeys(baseline, values).length, [baseline, values]);
  const dirty = changedCount > 0;

  /*
   * The browser's own "leave site?" prompt. It is the only guard that works on a tab close or a
   * reload; an in-app Back is a client-side navigation the browser never tells us about, so the
   * bar's own amber is what covers that case.
   */
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy field: Safari and older Chrome still need it set for the prompt to appear.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /**
   * A save landed. The values that went with it ARE the setup now, so the next edit counts from
   * them — passed in rather than read from a ref so it is the values of the render the press
   * started on, never whatever the driver typed while the request was in flight.
   */
  const settled = useCallback((written: unknown) => {
    setBaseline(written);
    setStatus("saved");
  }, []);

  /*
   * "Saved" is a receipt, not a state to sit in. Left up, it becomes the bar's resting text and says
   * nothing about the setup on screen — the driver can edit for a minute under a word claiming
   * everything is stored. It goes back to a blank bar after a beat.
   */
  useEffect(() => {
    if (status !== "saved") return;
    const t = window.setTimeout(() => setStatus("idle"), 3000);
    return () => window.clearTimeout(t);
  }, [status]);

  /** Writes over the setup in the URL. Only ever reached in `inPlace`. */
  const saveOver = useCallback(async () => {
    setBusy(true);
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/setup-snapshots/${setupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: getData() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save.");
      }
      settled(values);
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }, [setupId, getData, settled, values, router]);

  /**
   * Correct a run: a new snapshot, and that run alone repointed at it. Runs still on the old
   * snapshot keep it — this writes nothing over.
   */
  const correctRun = useCallback(
    async (runId: string) => {
      setBusy(true);
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/setup-snapshot`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupData: getData() }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not update the run.");
        }
        const body = (await res.json()) as { snapshot: { id: string } };
        settled(values);
        // The run points at a new snapshot now; the one still in the URL is no longer its record,
        // so the driver is taken to the row that is — still on the run's side of the door.
        router.push(
          `/cars/${carId}/setups/${body.snapshot.id}/edit?run=${encodeURIComponent(runId)}`
        );
        router.refresh();
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not update the run.");
        setBusy(false);
      }
    },
    [carId, router, getData, settled, values]
  );

  /**
   * "Keep this as its own setup" — how a baseline for the next meeting gets made, and the primary
   * door out of a run's setup opened from the garage.
   *
   * The values travel with the request: `fromSetupSnapshotId` would re-read the SOURCE row on the
   * server and quietly throw this edit away. `baseSetupSnapshotId` is the provenance, and is what
   * lets the new setup say what it was edited from.
   */
  const saveAsNew = useCallback(async () => {
    setBusy(true);
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          name: `${setupName?.trim() || "Setup"} (edited)`,
          data: getData(),
          baseSetupSnapshotId: setupId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not create the new setup.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      settled(values);
      // No `?run=`: the copy is nobody's record, and further edits should land on it in place.
      router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not create the new setup.");
      setBusy(false);
    }
  }, [carId, setupId, setupName, router, getData, settled, values]);

  /**
   * Renaming is allowed on any setup of the driver's, including a run's own record — only a run
   * snapshot's VALUES are frozen, never its label. This is where the name lands after a fork saved
   * without asking for one.
   */
  const rename = useCallback(async () => {
    const entered = window.prompt("Setup name", setupName ?? "");
    if (entered == null) return;
    const name = entered.trim();
    if (!name || name === setupName) return;
    setBusy(true);
    setError(null);
    try {
      await renameSetup(setupId, name);
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not rename this setup.");
    } finally {
      setBusy(false);
    }
  }, [setupId, setupName, router]);

  const forkAction: SetupEditorSaveAction = {
    label: "Save as new setup",
    busyLabel: "Saving…",
    run: saveAsNew,
    // A copy of a teammate's setup, taken exactly as it stands, is the reason this door exists.
    loudWhenClean: true,
  };

  let primary: SetupEditorSaveAction;
  let secondary: SetupEditorSaveAction | null;
  let note: string | null = null;

  if (saveMode.kind === "inPlace") {
    primary = { label: "Save changes", busyLabel: "Saving…", run: saveOver };
    secondary = forkAction;
  } else if (saveMode.kind === "correctRun") {
    const runId = saveMode.runId;
    primary = {
      label: "Correct this run",
      busyLabel: "Correcting…",
      run: () => correctRun(runId),
    };
    secondary = forkAction;
    note = "You opened this from the run, so saving changes what that run says it raced.";
  } else {
    primary = forkAction;
    const runId = saveMode.correctableRunId;
    secondary = runId
      ? { label: "Correct this run", busyLabel: "Correcting…", run: () => correctRun(runId) }
      : null;
    note =
      saveMode.runCount === 1
        ? "Saving keeps the run as it was and puts your changes in a setup of their own."
        : `${saveMode.runCount} runs were logged on these numbers, so they stay as they are. Open a run if you need to correct that one.`;
  }

  return {
    status,
    error,
    busy,
    dirty,
    changedCount,
    primary,
    secondary,
    rename,
    note,
  };
}
