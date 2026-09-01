"use client";

import { useEffect, useMemo } from "react";
import { Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { Spinner } from "@/components/ui/Spinner";
import { useShareFiles, type ShareTarget } from "@/components/share/useShareFiles";
import { useSetupEditorShareState } from "@/components/setup/setupEditorShare";

/**
 * Hand a setup over — one file, so no sheet and nothing to choose.
 *
 * The run share has options because a run has parts a driver might not want to publish. A setup
 * is one indivisible thing: the sheet, or nothing.
 *
 * ## One button, and on a sheet chassis it hands over the PDF
 *
 * There used to be a Share (a picture) and, four taps away behind "⋯ → View as PDF → Download", a
 * file. Founder call, 2026-09-01: one button, and what it hands over is the PDF — the thing a
 * driver actually files and forwards. On a chassis the app can't draw a sheet for there is no PDF
 * to give, so `asPdf` is false and the picture stays; the caller knows which, because it already
 * decided whether to render the paper.
 *
 * The word says "Download" because that is what a desk does with it: `useShareFiles` only reaches
 * for the OS share sheet on a touch device now, and the phone's share sheet holds "Save to Files"
 * anyway. A phone with no share sheet at all is sent to `downloadUrl` — the server's own attachment
 * response — because the blob anchor NAVIGATES on iOS and saves nothing.
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
  asPdf = false,
  className,
}: {
  setupSnapshotId: string;
  /** Setup name or session, for the share text and the saved filename. */
  label: string;
  /** True where the chassis draws a sheet, so there is a filled PDF to hand over. */
  asPdf?: boolean;
  className?: string;
}) {
  const { share, prefetch, preparing, state, error, route } = useShareFiles();
  const { dirty, savedCount } = useSetupEditorShareState();
  // Drawing ahead of the tap counts as busy — see the note in ShareRunSheet.
  const busy = state === "working" || preparing;

  const slug =
    label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "setup";

  const targets: ShareTarget[] = useMemo(() => {
    const id = encodeURIComponent(setupSnapshotId);
    // `v` is ignored by both routes and read by nothing — it exists to move the cache key in
    // `useShareFiles` when a save lands. Left off entirely where nothing can be saved, so the
    // details page asks for the same URL it always did.
    const bust = savedCount > 0 ? `v=${savedCount}` : "";
    return asPdf
      ? [
          {
            url: `/api/setup-snapshots/${id}/setup-pdf?download=1${bust ? `&${bust}` : ""}`,
            filename: `${slug}-setup.pdf`,
            // Where a phone with no share sheet is sent, instead of the blob anchor — on an iPhone
            // that anchor opens the sheet as a page and saves nothing (founder report, 2026-09-01).
            downloadUrl: `/api/setup-snapshots/${id}/setup-pdf?download=1`,
          },
        ]
      : [
          {
            url: `/api/setup-snapshots/${id}/share-image${bust ? `?${bust}` : ""}`,
            filename: `${slug}-setup.png`,
          },
        ];
  }, [setupSnapshotId, slug, savedCount, asPdf]);

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
        title={asPdf ? "Download the PDF" : "Share"}
        className={cn(
          outlineButtonClassName(),
          "inline-flex items-center gap-2 disabled:opacity-60",
          className
        )}
      >
        {busy ? <Spinner /> : <Share2 className="size-3.5" strokeWidth={2} aria-hidden />}
        {dirty ? "Save first" : busy ? "Drawing…" : asPdf ? "Download" : "Share"}
      </button>
      {/* The "why" for that label is `SetupEditorShareNote`, on its own line under the button row:
          a sentence this long inside the row is a flex item wide enough to wrap the buttons beside
          it onto a second line. */}
      {error ? <p className="text-[11.5px] text-destructive">{error}</p> : null}
      {/* Only the path this code WATCHED save gets to say so. A hand-off to the browser is
          announced by the platform's own download UI, and claiming it here was the lie. */}
      {state === "downloaded" && route === "blob" ? (
        <p className="text-[11.5px] text-muted-foreground">Saved to your downloads.</p>
      ) : null}
    </div>
  );
}
