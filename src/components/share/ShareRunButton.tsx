"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { ShareRunSheet } from "@/components/share/ShareRunSheet";

/**
 * The Share affordance on a run.
 *
 * Deliberately not rendered at all when there is nothing to draw — see `runIsShareable`. A
 * button that opens a sheet showing a title and no figures teaches the driver the feature is
 * broken; Strava refuses the same way for an activity with no GPS.
 *
 * The sheet is only constructed once opened, so a Sessions list of fifty runs pays for fifty
 * buttons, not fifty portals.
 */
export function ShareRunButton({
  runId,
  runLabel,
  setupSnapshotId,
  className,
  compact = false,
}: {
  runId: string;
  runLabel: string;
  setupSnapshotId: string | null;
  className?: string;
  /** Icon-only, for the run-detail header row where the Edit control is also a square. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label="Share this run"
          title="Share this run"
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground transition hover:bg-muted/80",
            className
          )}
        >
          <Share2 className="h-4 w-4" strokeWidth={2} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(outlineButtonClassName(), "inline-flex items-center gap-2", className)}
        >
          <Share2 className="size-4" strokeWidth={2} aria-hidden />
          Share
        </button>
      )}

      {open ? (
        <ShareRunSheet
          open={open}
          onClose={() => setOpen(false)}
          runId={runId}
          runLabel={runLabel}
          setupSnapshotId={setupSnapshotId}
        />
      ) : null}
    </>
  );
}
