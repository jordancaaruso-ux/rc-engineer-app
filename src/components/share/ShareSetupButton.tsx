"use client";

import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { useShareFiles } from "@/components/share/useShareFiles";

/**
 * Share a setup on its own — one picture, so no sheet and nothing to choose.
 *
 * The run share has options because a run has parts a driver might not want to publish. A setup
 * is one indivisible thing: the sheet, or nothing.
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
  const { share, state, error } = useShareFiles();
  const busy = state === "working";

  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "setup";

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void share(
            [
              {
                url: `/api/setup-snapshots/${encodeURIComponent(setupSnapshotId)}/share-image`,
                filename: `${slug}-setup.png`,
              },
            ],
            { title: label, text: label }
          )
        }
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
