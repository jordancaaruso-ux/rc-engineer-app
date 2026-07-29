"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SetupSheetView } from "@/components/runs/SetupSheetView";
import type { SetupSnapshotData } from "@/lib/runSetup";
import type { SetupSheetTemplate } from "@/lib/setupSheetTemplate";

/**
 * Grid editor for a saved library setup, with debounced autosave.
 *
 * Uses the existing `SetupSheetView` unchanged — a library setup and a run setup are the same
 * shape, so they get the same sheet.
 */

const SAVE_DEBOUNCE_MS = 800;

export function LibrarySetupEditorClient({
  carId,
  setupId,
  setupName,
  initialValues,
  template,
}: {
  carId: string;
  setupId: string;
  /** Seeds the name prompt when copying this setup. */
  setupName?: string | null;
  initialValues: SetupSnapshotData;
  template: SetupSheetTemplate;
}) {
  const router = useRouter();
  const [values, setValues] = useState<SetupSnapshotData>(initialValues);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  // Skip the save that the initial render would otherwise trigger.
  const dirty = useRef(false);

  const save = useCallback(
    async (next: SetupSnapshotData) => {
      setStatus("saving");
      setError(null);
      try {
        const res = await fetch(`/api/setup-snapshots/${setupId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: next }),
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
    },
    [setupId]
  );

  useEffect(() => {
    if (!dirty.current) return;
    const t = window.setTimeout(() => void save(values), SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [values, save]);

  /**
   * "Copy this and tweak it" — the common way a baseline for a new track gets made. Flushes the
   * pending autosave first: navigating away unmounts the debounce effect, which would otherwise
   * discard the edits still sitting on the setup being copied.
   */
  const saveAsNew = async () => {
    const raw = window.prompt("Name for the new setup", `${setupName ?? "Setup"} copy`);
    if (raw == null) return;
    const name = raw.trim();
    if (!name) return;

    setForking(true);
    setError(null);
    try {
      if (dirty.current) await save(values);
      const res = await fetch("/api/setup-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, name, data: values, baseSetupSnapshotId: setupId }),
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
      setForking(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex h-8 items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void saveAsNew()}
          disabled={forking}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
        >
          {forking ? "Copying…" : "Save as new setup"}
        </button>
        {status === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : status === "saved" ? (
          <span className="ui-caption text-muted-foreground">Saved</span>
        ) : status === "error" ? (
          <span className="ui-caption text-destructive">{error}</span>
        ) : null}
      </div>
      <SetupSheetView
        value={values}
        template={template}
        enableFieldSearch
        onChange={(next) => {
          dirty.current = true;
          setValues(next);
        }}
      />
    </div>
  );
}
