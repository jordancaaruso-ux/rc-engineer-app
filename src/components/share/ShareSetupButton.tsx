"use client";

import { useEffect, useMemo } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { useShareFiles, type ShareTarget } from "@/components/share/useShareFiles";

/**
 * Share a setup on its own — one picture, so no sheet and nothing to choose.
 *
 * The run share has options because a run has parts a driver might not want to publish. A setup
 * is one indivisible thing: the sheet, or nothing.
 *
 * The picture is drawn on mount rather than on the tap. iOS only opens the share sheet while the
 * gesture is still live, and a server-side render is far slower than that — see the long note in
 * `useShareFiles`. One button on one setup's page, so warming it eagerly costs a single render of
 * a sheet the driver is already looking at.
 */
export function ShareSetupButton({
  setupSnapshotId,
  label,
  className,
}: {
  setupSnapshotId: string;
  /** Setup name or session, for the share text and the saved filename. */
  label: string;
  className?: string;
}) {
  const { share, prefetch, preparing, state, error } = useShareFiles();
  // Drawing ahead of the tap counts as busy — see the note in ShareRunSheet.
  const busy = state === "working" || preparing;

  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "setup";

  const targets: ShareTarget[] = useMemo(
    () => [
      {
        url: `/api/setup-snapshots/${encodeURIComponent(setupSnapshotId)}/share-image`,
        filename: `${slug}-setup.png`,
      },
    ],
    [setupSnapshotId, slug]
  );

  useEffect(() => {
    void prefetch(targets);
  }, [prefetch, targets]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => share(targets, { title: label, text: label })}
        className={cn(
          outlineButtonClassName(),
          "inline-flex items-center gap-2 disabled:opacity-60",
          className
        )}
      >
        {busy ? <Spinner /> : <Share2 className="size-4" strokeWidth={2} aria-hidden />}
        {busy ? "Drawing…" : "Share"}
      </button>
      {error ? <p className="text-[11.5px] text-destructive">{error}</p> : null}
      {state === "downloaded" ? (
        <p className="text-[11.5px] text-muted-foreground">Saved to your downloads.</p>
      ) : null}
    </div>
  );
}
