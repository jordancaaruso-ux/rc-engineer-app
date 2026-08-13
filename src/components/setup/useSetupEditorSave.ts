"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type RefObject } from "react";
import type { SetupSaveMode } from "@/lib/setup/setupSaveMode";

/**
 * The save behaviour both setup editors share — the grid one and the sheet one. They differ only in
 * how a value gets from the screen into storage; what a save *means* is identical, and used to be
 * copy-pasted between them.
 *
 * Three doors, picked by `saveMode` (see `setupSaveMode.ts`):
 *
 * - `inPlace`    — writes over the setup. Debounced autosave on the driver's own saved setups; an
 *                  explicit "Save changes" on anything that arrived from elsewhere, so an uploaded
 *                  sheet's imported values are never quietly replaced by a stray tap.
 * - `correctRun` — NO autosave, because a keystroke must never quietly change what a logged run says
 *                  it raced. The driver presses the button; the run route writes a new snapshot and
 *                  repoints the run, and we follow the driver to that new row because the one they
 *                  opened is no longer the run's.
 * - `copyOnly`   — no in-place door at all.
 *
 * "Save as a new setup" always exists, and always records where it came from
 * (`baseSetupSnapshotId`), so the copy can say "Edited from …" rather than appearing from nowhere.
 */

const SAVE_DEBOUNCE_MS = 800;

export type SetupEditorSave = {
  status: "idle" | "saving" | "saved" | "error";
  error: string | null;
  /** A copy or a run correction is in flight; disable the buttons. */
  busy: boolean;
  /** Present only when the mode has an in-place door to press. */
  saveNow: (() => Promise<void>) | null;
  saveNowLabel: string;
  saveAsNew: () => Promise<void>;
  /** Why there is no in-place door, when there isn't one. Null when there is. */
  blockedReason: string | null;
};

export function useSetupEditorSave({
  carId,
  setupId,
  setupName,
  saveMode,
  values,
  getData,
  dirtyRef,
}: {
  carId: string;
  setupId: string;
  /** Seeds the name prompt when copying this setup. */
  setupName?: string | null;
  saveMode: SetupSaveMode;
  /** Re-arms the autosave debounce when it changes. Opaque to this hook. */
  values: unknown;
  /** Reads the editor's current values in the shape storage wants. Changes with `values`. */
  getData: () => Record<string, unknown>;
  /** False until the driver has actually touched something, so opening a setup saves nothing. */
  dirtyRef: RefObject<boolean>;
}): SetupEditorSave {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savePatch = useCallback(async () => {
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
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }, [setupId, getData]);

  const inPlace = saveMode.kind === "inPlace";
  const autosaves = saveMode.kind === "inPlace" && saveMode.autosave;

  useEffect(() => {
    if (!autosaves) return;
    if (!dirtyRef.current) return;
    const t = window.setTimeout(() => void savePatch(), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [values, savePatch, autosaves, dirtyRef]);

  const saveOver = useCallback(async () => {
    setBusy(true);
    await savePatch();
    setBusy(false);
  }, [savePatch]);

  const correctRun = useCallback(async () => {
    if (saveMode.kind !== "correctRun") return;
    setBusy(true);
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch(`/api/runs/${saveMode.runId}/setup-snapshot`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupData: getData() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not update the run.");
      }
      const body = (await res.json()) as { snapshot: { id: string } };
      setStatus("saved");
      // The run points at a new snapshot now; the one still in the URL is no longer its record.
      router.push(`/cars/${carId}/setups/${body.snapshot.id}`);
      router.refresh();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not update the run.");
      setBusy(false);
    }
  }, [saveMode, carId, router, getData]);

  /**
   * "Copy this and tweak it" — the common way a baseline for a new track gets made, and the only
   * door out of a setup that can't be written over. On an in-place setup it flushes the pending
   * autosave first: navigating away unmounts the debounce effect, which would otherwise discard the
   * edits still sitting on the setup being copied.
   */
  const saveAsNew = useCallback(async () => {
    const raw = window.prompt("Name for the new setup", `${setupName ?? "Setup"} (edited)`);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      if (inPlace && dirtyRef.current) await savePatch();
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carId,
          name,
          // The edits win, so the values travel with the request; `fromSetupSnapshotId` would read
          // the SOURCE row server-side and quietly throw this edit away.
          data: getData(),
          baseSetupSnapshotId: setupId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not create the new setup.");
      }
      const body = (await res.json()) as { setup: { id: string } };
      router.push(`/cars/${carId}/setups/${body.setup.id}/edit`);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Could not create the new setup.");
      setBusy(false);
    }
  }, [carId, setupId, setupName, inPlace, savePatch, router, getData, dirtyRef]);

  return {
    status,
    error,
    busy,
    saveNow:
      saveMode.kind === "correctRun" ? correctRun : inPlace && !autosaves ? saveOver : null,
    saveNowLabel: saveMode.kind === "correctRun" ? "Correct this run" : "Save changes",
    saveAsNew,
    blockedReason:
      saveMode.kind === "copyOnly"
        ? `${saveMode.runCount} logged runs share this setup, so changing it would rewrite all of them. Save your changes as a new setup instead.`
        : null,
  };
}
