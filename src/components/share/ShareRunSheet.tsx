"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import {
  defaultSectionsForMode,
  serializeSections,
  type ShareMode,
  type ShareSectionKey,
  type ShareSections,
} from "@/lib/share/shareCardModel";
import { useShareFiles, type ShareTarget } from "@/components/share/useShareFiles";

/**
 * "Share this run" — pick how much travels, look at it, send it.
 *
 * The preview is an `<img>` pointed straight at the render route, so what you look at is the
 * file that gets sent, byte for byte. Nothing is composed in the browser; there is no second
 * implementation of the card to drift.
 *
 * Same bottom-sheet construction as `PickerSheet`: portalled to `<body>` (this mounts inside
 * cards, and a transformed ancestor turns `fixed` into `absolute`), body scroll locked while open.
 */

const SECTION_LABELS: Record<ShareSectionKey, string> = {
  pace: "Pace vs field",
  laps: "Every lap",
  graph: "Lap trace",
  notes: "Notes & feel",
};

/** Order shown to the driver — roughly the order they appear on the picture. */
const SECTION_ORDER: ShareSectionKey[] = ["pace", "laps", "graph", "notes"];

export function ShareRunSheet({
  open,
  onClose,
  runId,
  runLabel,
  setupSnapshotId,
}: {
  open: boolean;
  onClose: () => void;
  runId: string;
  /** Used for the OS share text and the downloaded filename. */
  runLabel: string;
  /** Null when this run has no setup to attach. */
  setupSnapshotId: string | null;
}) {
  const [mode, setMode] = useState<ShareMode>("headline");
  const [sections, setSections] = useState<ShareSections>(() => defaultSectionsForMode("headline"));
  const [includeSetup, setIncludeSetup] = useState<boolean>(Boolean(setupSnapshotId));
  const [previewLoading, setPreviewLoading] = useState(true);

  const sheet = useEnterExit(open, 300);
  const { share, state, error, skipped, reset } = useShareFiles();

  // Every open starts from the quick path; a stale "full run with notes" from last time is a
  // surprising thing to hit Share on.
  useEffect(() => {
    if (!open) return;
    setMode("headline");
    setSections(defaultSectionsForMode("headline"));
    setIncludeSetup(Boolean(setupSnapshotId));
    reset();
  }, [open, setupSnapshotId, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const cardUrl = useMemo(() => {
    const query = new URLSearchParams({ mode });
    const list = serializeSections(sections);
    if (list) query.set("sections", list);
    return `/api/runs/${encodeURIComponent(runId)}/share-card?${query.toString()}`;
  }, [runId, mode, sections]);

  useEffect(() => {
    setPreviewLoading(true);
  }, [cardUrl]);

  const slug = runLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";

  const targets: ShareTarget[] = useMemo(() => {
    const list: ShareTarget[] = [{ url: cardUrl, filename: `${slug}.png` }];
    if (includeSetup && setupSnapshotId) {
      list.push({
        url: `/api/setup-snapshots/${encodeURIComponent(setupSnapshotId)}/share-image`,
        filename: `${slug}-setup.png`,
        // Not every chassis has a sheet the app can draw; losing the attachment must not lose the run.
        optional: true,
      });
    }
    return list;
  }, [cardUrl, includeSetup, setupSnapshotId, slug]);

  function chooseMode(next: ShareMode) {
    setMode(next);
    // Full run IS the expanded session view, so it brings everything with it.
    setSections(defaultSectionsForMode(next));
  }

  if (!sheet.mounted || typeof document === "undefined") return null;

  const busy = state === "working";
  const sendLabel =
    targets.length > 1 ? `Share ${targets.length} pictures` : "Share";

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[70] flex items-end justify-center bg-black/50 transition-opacity duration-300 ease-out motion-reduce:transition-none sm:items-center",
        sheet.entered ? "opacity-100" : "opacity-0"
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Share this run"
      onClick={onClose}
    >
      <div
        className={cn(
          "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          "max-h-[min(90dvh,46rem)]",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-3 sm:hidden">
          <div className="mx-auto h-1 w-9 rounded-full bg-white/15" aria-hidden />
        </div>

        <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold tracking-tight text-foreground">
              Share this run
            </h2>
            <p className="truncate text-[12px] text-muted-foreground">{runLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex gap-1.5" role="group" aria-label="How much to share">
            {(["headline", "full"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => chooseMode(m)}
                className={cn(chipToggleClass(mode === m), "flex-1 px-3 py-2 text-[13px]")}
              >
                {m === "headline" ? "Headline" : "Full run"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 px-4 pb-3" role="group" aria-label="What to include">
          {SECTION_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={sections[key]}
              onClick={() => setSections((s) => ({ ...s, [key]: !s[key] }))}
              className={cn(chipToggleClass(sections[key]), "px-3 py-1.5 text-[12px]")}
            >
              {SECTION_LABELS[key]}
            </button>
          ))}
          {setupSnapshotId ? (
            <button
              type="button"
              aria-pressed={includeSetup}
              onClick={() => setIncludeSetup((v) => !v)}
              className={cn(chipToggleClass(includeSetup), "px-3 py-1.5 text-[12px]")}
            >
              Setup sheet
            </button>
          ) : null}
        </div>

        {/* The preview IS the file. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-white/10 bg-background/40 px-4 py-3">
          <div className="relative mx-auto w-full max-w-[240px]">
            {previewLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- a PNG route, not an app asset */}
            <img
              src={cardUrl}
              alt="Preview of the picture that will be shared"
              className={cn(
                "w-full rounded-lg border border-border transition-opacity",
                previewLoading ? "opacity-0" : "opacity-100"
              )}
              onLoad={() => setPreviewLoading(false)}
              onError={() => setPreviewLoading(false)}
            />
          </div>
          {includeSetup && setupSnapshotId ? (
            <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
              Your setup sheet sends as a second picture.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 px-4 pt-3">
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
          {skipped ? <p className="text-[12px] text-muted-foreground">{skipped}</p> : null}
          {state === "downloaded" ? (
            <p className="text-[12px] text-muted-foreground">
              Saved to your downloads — this browser can&apos;t open the share sheet.
            </p>
          ) : null}
          <Button
            type="button"
            disabled={busy}
            onClick={() => void share(targets, { title: runLabel, text: runLabel })}
          >
            {busy ? (
              <span className="flex items-center gap-2">
                <Spinner /> Drawing…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Share2 className="size-4" strokeWidth={2} aria-hidden />
                {sendLabel}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
