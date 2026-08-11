"use client";

import { useState } from "react";

/**
 * Download the sheet as a PDF, filled in.
 *
 * Reads the same draft the fill surface writes, so what gets exported is exactly what is on screen
 * — which makes this the honest test of whether the app draws values the way the sheet does.
 */
export function SheetExportButton({
  exportUrl,
  storageKey,
  filename,
}: {
  exportUrl: string;
  storageKey: string;
  filename: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "error">("idle");
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    setState("working");
    setNote(null);
    try {
      const raw = window.localStorage.getItem(storageKey);
      const values = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      const res = await fetch(exportUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      const written = res.headers.get("X-Fill-Written") ?? "0";
      const conflicts = Number(res.headers.get("X-Fill-Conflicts") ?? "0");
      setNote(
        conflicts > 0
          ? `${written} boxes written · ${conflicts} the file could only hold one answer for`
          : `${written} boxes written`
      );
      setState("idle");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Export failed");
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={state === "working"}
        className="tap-active rounded-md border border-border bg-secondary px-3 py-2 text-[13px] disabled:opacity-50"
      >
        {state === "working" ? "Filling…" : "Download filled PDF"}
      </button>
      {note ? (
        <span className={`text-[12px] ${state === "error" ? "text-destructive" : "text-faint"}`}>{note}</span>
      ) : null}
    </div>
  );
}
