"use client";

import { useEffect, useMemo } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { useShareFiles, type ShareTarget } from "@/components/share/useShareFiles";
import { useSetupEditorShareState } from "@/components/setup/setupEditorShare";

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
 *
 * ## On the editor page, the picture is not what is on screen
 *
 * The same button sits above the setup EDITOR, where the boxes can be ahead of what is stored —
 * and the picture is always drawn by the server, from storage. Two things follow, and they only
 * work as a pair (see `setupEditorShare`):
 *
 *  - With unsaved changes the button will not send, and says why. Sharing would otherwise post the
 *    old numbers with nothing on screen admitting it.
 *  - Every save moves the picture's URL, because `useShareFiles` caches a drawn picture against its
 *    URL forever. Without that, asking the driver to save first would walk them straight into
 *    receiving their PRE-save sheet on the next tap — the fault the ask was meant to prevent.
 *
 * On the setup details page there is no editor and no provider, so both fall back to resting and
 * this behaves exactly as it always has.
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
  const { dirty, savedCount } = useSetupEditorShareState();
  // Drawing ahead of the tap counts as busy — see the note in ShareRunSheet.
  const busy = state === "working" || preparing;

  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "setup";

  const targets: ShareTarget[] = useMemo(
    () => [
      {
        // `v` is ignored by the route and read by nothing — it exists to move the cache key in
        // `useShareFiles` when a save lands. Left off entirely where nothing can be saved, so the
        // details page asks for the same URL it always did.
        url: `/api/setup-snapshots/${encodeURIComponent(setupSnapshotId)}/share-image${
          savedCount > 0 ? `?v=${savedCount}` : ""
        }`,
        filename: `${slug}-setup.png`,
      },
    ],
    [setupSnapshotId, slug, savedCount]
  );

  useEffect(() => {
    // Nothing to warm while the boxes are ahead of storage: the tap is going to be refused, and
    // the picture drawn now would be the wrong one anyway. The save that clears `dirty` is what
    // starts the draw.
    if (dirty) return;
    void prefetch(targets);
  }, [prefetch, targets, dirty]);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy || dirty}
        onClick={() => share(targets, { title: label, text: label })}
        className={cn(
          outlineButtonClassName(),
          "inline-flex items-center gap-2 disabled:opacity-60",
          className
        )}
      >
        {busy ? <Spinner /> : <Share2 className="size-4" strokeWidth={2} aria-hidden />}
        {dirty ? "Save to share" : busy ? "Drawing…" : "Share"}
      </button>
      {/* The "why" for that label is `SetupEditorShareNote`, on its own line under the button row:
          a sentence this long inside the row is a flex item wide enough to wrap the buttons beside
          it onto a second line. */}
      {error ? <p className="text-[11.5px] text-destructive">{error}</p> : null}
      {state === "downloaded" ? (
        <p className="text-[11.5px] text-muted-foreground">Saved to your downloads.</p>
      ) : null}
    </div>
  );
}
