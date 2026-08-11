"use client";

import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { setupFillDraftProgressLabel } from "@/lib/setup/setupFillDraft";

/**
 * "You left a fill part-way through" — the way back into a parked sequential setup fill.
 *
 * Amber-tinted like `WizardDraftsCard`, deliberately: an unfinished thing you should come back to
 * reads the same everywhere in the app, and neither is a normal list item.
 */
export function SetupFillDraftResumeCard({
  answeredCount,
  stepCount,
  updatedAt,
  busy = false,
  onResume,
  onStartOver,
}: {
  answeredCount: number;
  stepCount: number;
  updatedAt: string;
  busy?: boolean;
  onResume: () => void;
  onStartOver: () => void;
}) {
  return (
    <CardPanel contentClassName="space-y-2" className="border-amber-500/40">
      <Eyebrow>Draft in progress</Eyebrow>
      <p className="font-mono text-[11px] text-muted-foreground">
        {setupFillDraftProgressLabel(answeredCount, stepCount)} ·{" "}
        {/* Server-safe fallback: this renders inside a server-rendered page. */}
        <RelativeTime iso={updatedAt} fallback="recently" />
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm font-semibold text-warning hover:border-amber-500/70 disabled:opacity-60 dark:text-amber-300"
          onClick={onResume}
          disabled={busy}
        >
          Resume
        </button>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground disabled:opacity-60"
          onClick={onStartOver}
          disabled={busy}
        >
          {busy ? "Clearing…" : "Start over"}
        </button>
      </div>
    </CardPanel>
  );
}
