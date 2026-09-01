"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { outlineButtonClassName } from "@/components/ui/ButtonLink";
import { useShareFiles } from "@/components/share/useShareFiles";

/**
 * The `/pdf-view` page's body: the framed PDF as pictures, and the file itself behind Download.
 *
 * Pictures, not an `<iframe>` — iOS clips a framed PDF to a non-scrolling strip (founder
 * screenshot, 2026-09-01). The app viewport pins pinch-zoom (`user-scalable=no`), so readability
 * at 390px comes from the Fit / 100% toggle: Fit shows the whole page, 100% shows it at reading
 * size inside a pannable scroll box.
 *
 * Download goes through `useShareFiles`, never an `<a>` at the file: iOS ignores the `download`
 * attribute and NAVIGATES to the PDF — the exact stuck-with-no-chrome view this page exists to
 * end, with nothing saved either (founder report, 2026-09-01, second round). The share sheet is
 * how a phone keeps a file; desktop falls back to a real blob download. The file is prefetched on
 * mount so the tap reaches `navigator.share()` still warm — see the hook's header.
 */
export function PdfPageImages({
  imageBase,
  downloadHref,
  filename,
  title,
}: {
  imageBase: string;
  /** The actual file — pictures are for looking, this is for keeping. */
  downloadHref: string;
  filename: string;
  title: string;
}) {
  const [pages, setPages] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const { state, error, prefetch, share, route } = useShareFiles();

  useEffect(() => {
    let cancelled = false;
    fetch(`${imageBase}&meta=1`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { pages?: number } | null) => {
        if (cancelled) return;
        if (d?.pages && d.pages >= 1) setPages(d.pages);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [imageBase]);

  useEffect(() => {
    void prefetch([{ url: downloadHref, filename, downloadUrl: downloadHref }]);
  }, [prefetch, downloadHref, filename]);

  const downloadLabel =
    state === "working"
      ? "Sending…"
      : state === "shared"
        ? "Sent"
        : // Only a save this code watched happen says "Saved". A hand-off to the browser is the
          // platform's to report, and iOS reports it in its own download sheet.
          state === "downloaded" && route === "blob"
          ? "Saved"
          : "Download";

  const downloadButton = (
    <button
      type="button"
      onClick={() => share([{ url: downloadHref, filename, downloadUrl: downloadHref }], { title })}
      disabled={state === "working"}
      className={outlineButtonClassName()}
    >
      {downloadLabel}
    </button>
  );

  if (failed) {
    return (
      <div className="space-y-2">
        <p className="ui-caption px-1">Couldn’t draw this file.</p>
        <div className="flex justify-end">{downloadButton}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end gap-2">
        {error ? <p className="ui-caption min-w-0 flex-1 truncate px-1">{error}</p> : null}
        {downloadButton}
        <button
          type="button"
          onClick={() => setActualSize((v) => !v)}
          className={outlineButtonClassName()}
        >
          {actualSize ? "Fit" : "100%"}
        </button>
      </div>
      <div className="max-h-[calc(100svh-16rem)] overflow-auto overscroll-contain rounded-lg border border-border bg-white">
        {Array.from({ length: pages ?? 1 }, (_, i) => (
          <img
            key={i}
            src={`${imageBase}&page=${i + 1}`}
            alt={`Page ${i + 1}`}
            className={cn(
              "border-b border-border last:border-b-0",
              actualSize ? "w-[1190px] max-w-none" : "w-full"
            )}
          />
        ))}
      </div>
    </div>
  );
}
