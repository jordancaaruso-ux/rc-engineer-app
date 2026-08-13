"use client";

import type { SetupEditorSave } from "@/components/setup/useSetupEditorSave";

/**
 * The strip above a setup editor. Identical for the grid and the sheet, so it lives once.
 *
 * The in-place button only exists when there is something explicit to press — an autosaving setup
 * says "Saved" and needs no button, and a setup shared by several runs says why it has none.
 */
export function SetupEditorSaveBar({ save }: { save: SetupEditorSave }) {
  return (
    <div className="space-y-1">
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {save.saveNow ? (
            <button
              type="button"
              onClick={() => void save.saveNow?.()}
              disabled={save.busy}
              className="tap-active rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {save.busy ? "Saving…" : save.saveNowLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void save.saveAsNew()}
            disabled={save.busy}
            className="tap-active rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
          >
            {save.busy ? "Copying…" : "Save as new setup"}
          </button>
        </div>
        {save.status === "saving" ? (
          <span className="ui-caption text-muted-foreground">Saving…</span>
        ) : save.status === "saved" ? (
          <span className="ui-caption text-muted-foreground">Saved</span>
        ) : save.status === "error" ? (
          <span className="ui-caption text-destructive">{save.error}</span>
        ) : null}
      </div>
      {save.blockedReason ? <p className="ui-caption px-0.5">{save.blockedReason}</p> : null}
    </div>
  );
}
