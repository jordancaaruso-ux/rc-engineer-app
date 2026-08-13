"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnterExit } from "@/components/ui/Collapse";
import { chipToggleClass } from "@/components/ui/chipToggle";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import {
  allSectionsOn,
  parseCardStyle,
  parseSectionsParam,
  serializeSections,
  type ShareCardStyle,
  type ShareSectionKey,
  type ShareSections,
} from "@/lib/share/shareCardModel";
import { useShareFiles, type ShareTarget } from "@/components/share/useShareFiles";

/**
 * "Share this run" — choose what travels, look at exactly what will be sent, send it.
 *
 * The preview is an `<img>` pointed straight at the render route, so what you look at is the
 * file that gets sent, byte for byte. Nothing is composed in the browser; there is no second
 * implementation of the card to drift. That is also why the preview is a horizontal pager rather
 * than a stack: page 2 is the setup sheet, a genuinely separate file, and the sliver of it peeking
 * at the right edge is what tells the driver a second picture exists.
 *
 * Same bottom-sheet construction as `PickerSheet`: portalled to `<body>` (this mounts inside
 * cards, and a transformed ancestor turns `fixed` into `absolute`), body scroll locked while open.
 *
 * Redesigned 2026-08-13. The Headline / Full mode chips are gone: they silently reset the section
 * flags underneath the driver, which was the actual complaint. Now nothing overrides anything —
 * a style picker on top, one flat row of chips below, and every chip means only itself.
 */

const SECTION_LABELS: Record<ShareSectionKey, string> = {
  details: "Session details",
  laps: "Every lap",
  graph: "Lap trace",
  setup: "Setup changes",
  notes: "Notes",
  feel: "How it felt",
};

/** The order they appear on the picture. */
const SECTION_ORDER: ShareSectionKey[] = ["details", "laps", "graph", "setup", "notes", "feel"];

const STYLE_OPTIONS = [
  { value: "hero" as const, label: "Lead with the lap" },
  { value: "report" as const, label: "Full report" },
];

/**
 * Remembered per device, not per share (founder lean 2026-08-13). A driver who always sends the
 * full report should not re-tick six chips every Sunday.
 */
const PREFS_KEY = "jrc.share.card.v1";

type ShareCardPrefs = { style: ShareCardStyle; sections: ShareSections };

function readPrefs(): ShareCardPrefs {
  const fallback: ShareCardPrefs = { style: "hero", sections: allSectionsOn() };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { style?: unknown; sections?: unknown };
    return {
      style: parseCardStyle(typeof parsed.style === "string" ? parsed.style : null),
      // Round-tripped through the same parser the route uses, so an unknown name is ignored
      // rather than throwing — a stale key from an older build must never break the sheet.
      sections:
        typeof parsed.sections === "string" ? parseSectionsParam(parsed.sections) : allSectionsOn(),
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: ShareCardPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ style: prefs.style, sections: serializeSections(prefs.sections) })
    );
  } catch {
    // A private-mode browser with no storage quota is not a reason to fail a share.
  }
}

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
  const [cardStyle, setCardStyle] = useState<ShareCardStyle>("hero");
  const [sections, setSections] = useState<ShareSections>(allSectionsOn);
  const [includeSetup, setIncludeSetup] = useState<boolean>(Boolean(setupSnapshotId));
  const [previewLoading, setPreviewLoading] = useState(true);
  const [page, setPage] = useState(0);
  /**
   * Not every chassis has a sheet the app can draw, and the route 404s when it can't. Left alone
   * that renders a browser's broken-image glyph as page 2 of the driver's own share — so the page
   * says what happened instead. The chip stays on and the share still goes: `useShareFiles` treats
   * the sheet as optional and reports the gap in `skipped`.
   */
  const [setupPreviewFailed, setSetupPreviewFailed] = useState(false);

  const sheet = useEnterExit(open, 300);
  const { share, prefetch, preparing, state, error, skipped, reset } = useShareFiles();
  const pagerRef = useRef<HTMLDivElement | null>(null);

  // Every open starts from the driver's last choice, not a hard-coded default.
  useEffect(() => {
    if (!open) return;
    const prefs = readPrefs();
    setCardStyle(prefs.style);
    setSections(prefs.sections);
    setIncludeSetup(Boolean(setupSnapshotId));
    setPage(0);
    setSetupPreviewFailed(false);
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

  const wantedUrl = useMemo(() => {
    const query = new URLSearchParams({ style: cardStyle });
    const list = serializeSections(sections);
    if (list) query.set("sections", list);
    return `/api/runs/${encodeURIComponent(runId)}/share-card?${query.toString()}`;
  }, [runId, cardStyle, sections]);

  /*
   * Every chip redraws a 1080px picture server-side, so a driver walking the row would queue six
   * renders and watch the last one land. 150ms of quiet is enough to make a burst of taps cost one.
   */
  const [cardUrl, setCardUrl] = useState(wantedUrl);
  useEffect(() => {
    if (wantedUrl === cardUrl) return;
    const t = window.setTimeout(() => setCardUrl(wantedUrl), 150);
    return () => window.clearTimeout(t);
  }, [wantedUrl, cardUrl]);

  useEffect(() => {
    setPreviewLoading(true);
  }, [cardUrl]);

  // Persist what the driver settled on, not every intermediate tap.
  useEffect(() => {
    if (!open) return;
    writePrefs({ style: cardStyle, sections });
  }, [open, cardStyle, sections]);

  const slug = runLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "run";
  const setupImageUrl = setupSnapshotId
    ? `/api/setup-snapshots/${encodeURIComponent(setupSnapshotId)}/share-image`
    : null;

  const targets: ShareTarget[] = useMemo(() => {
    const list: ShareTarget[] = [{ url: cardUrl, filename: `${slug}.png` }];
    if (includeSetup && setupImageUrl) {
      list.push({
        url: setupImageUrl,
        filename: `${slug}-setup.png`,
        // Not every chassis has a sheet the app can draw; losing the attachment must not lose the run.
        optional: true,
      });
    }
    return list;
  }, [cardUrl, includeSetup, setupImageUrl, slug]);

  /*
   * Draw the pictures before the driver asks for them.
   *
   * iOS only opens the share sheet while the tap is still live, and two 1080px renders take far
   * longer than that — which is what made every share on the installed PWA come back "the request
   * is not allowed by the user agent". Fetching here means `share()` hands the platform files it
   * already holds. Both routes cache for 300s, so the card the preview `<img>` just loaded costs
   * nothing to fetch a second time.
   *
   * Deliberately after `previewLoading` clears: kicking the blob fetch off alongside the preview
   * would race the same render twice and pay for both.
   */
  useEffect(() => {
    if (!open || previewLoading) return;
    void prefetch(targets);
  }, [open, previewLoading, targets, prefetch]);

  const pageCount = includeSetup && setupImageUrl ? 2 : 1;

  const onPagerScroll = useCallback(() => {
    const el = pagerRef.current;
    if (!el) return;
    // Page width plus the 10px gutter — whichever page owns the left edge is the one showing.
    const next = Math.round(el.scrollLeft / 335);
    setPage((p) => (p === next ? p : next));
  }, []);

  function everything() {
    setSections(allSectionsOn());
    // "Everything" means everything in the row, and the setup sheet is the seventh chip.
    if (setupSnapshotId) setIncludeSetup(true);
  }

  if (!sheet.mounted || typeof document === "undefined") return null;

  /*
   * Busy until the picture is drawn AND in hand.
   *
   * `preparing` alone left a window: for the first second the preview is still rendering, the
   * prefetch has not started, and a tap went straight down the slow path — the one iOS refuses.
   * Including `previewLoading` also makes the button honest, since it can no longer send a picture
   * the driver has not been shown.
   */
  const busy = state === "working" || preparing || previewLoading;
  // Counts what will actually arrive. Saying "2 pictures" beside a page reading "no sheet to draw"
  // is the sheet arguing with itself, so a known-undrawable sheet is not counted.
  const sendLabel = targets.length > 1 && !setupPreviewFailed ? "Share 2 pictures" : "Share picture";

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
          "flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-card/96 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-16px_40px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none sm:rounded-2xl sm:pb-2",
          // The preview needs the height — it is the surface of the sheet now, not a thumbnail.
          "max-h-[94dvh]",
          sheet.entered ? "translate-y-0" : "translate-y-full sm:translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-9 rounded-full bg-white/15" aria-hidden />
        </div>

        <div className="flex items-start justify-between gap-2 px-4 pb-2.5 pt-2">
          <div className="min-w-0">
            <h2 className="truncate text-[18px] font-bold tracking-tight text-foreground">
              Share this run
            </h2>
            <p className="truncate text-[12.5px] text-muted-foreground">{runLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-active -mr-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="px-4 pb-2.5">
          <SegmentedControl
            options={STYLE_OPTIONS}
            value={cardStyle}
            onChange={setCardStyle}
            ariaLabel="Card style"
            segmentClassName="!px-3 !py-[9px] !text-[13.5px] tracking-[-0.02em]"
          />
        </div>

        {/* The preview IS the file. Page 2 is a second file, so it is a page, not a caption. */}
        <div className="px-4 pb-3">
          <div className="relative h-[236px] overflow-hidden rounded-xl border border-border bg-surface-runna-deep">
            <div
              ref={pagerRef}
              onScroll={onPagerScroll}
              className="flex h-full snap-x snap-mandatory gap-2.5 overflow-x-auto overscroll-x-contain p-2.5 pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="h-fit w-[325px] shrink-0 snap-start overflow-hidden rounded-lg border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element -- a PNG route, not an app asset */}
                <img
                  src={cardUrl}
                  alt="Preview of the picture that will be shared"
                  className={cn(
                    "block w-full transition-opacity",
                    previewLoading ? "opacity-0" : "opacity-100"
                  )}
                  onLoad={() => setPreviewLoading(false)}
                  onError={() => setPreviewLoading(false)}
                />
              </div>
              {includeSetup && setupImageUrl ? (
                <div className="h-full w-[325px] shrink-0 snap-start overflow-hidden rounded-lg border border-border">
                  {setupPreviewFailed ? (
                    <div className="flex h-full flex-col items-center justify-center gap-1 px-6 pb-6 text-center">
                      <p className="text-[12.5px] font-semibold text-muted-foreground">
                        No sheet to draw for this car
                      </p>
                      <p className="text-[11.5px] text-faint">
                        The run picture still sends on its own.
                      </p>
                    </div>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- a PNG route, not an app asset
                    <img
                      src={setupImageUrl}
                      alt="Preview of your setup sheet, which sends as a second picture"
                      className="block w-full"
                      onError={() => setSetupPreviewFailed(true)}
                    />
                  )}
                </div>
              ) : null}
            </div>

            {previewLoading ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Spinner />
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-b from-transparent to-[rgb(var(--color-surface-runna-deep))]" />
            {pageCount > 1 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
                {Array.from({ length: pageCount }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "rounded-full",
                      i === page ? "h-1 w-4 bg-foreground" : "size-1 bg-faint"
                    )}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="flex items-center justify-between px-4 pb-1.5">
            <span className="text-[12px] font-semibold text-muted-foreground">In the picture</span>
            <button
              type="button"
              onClick={everything}
              className="tap-active text-[12px] font-semibold text-faint transition-colors hover:text-foreground"
            >
              Everything
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 px-4 pb-3.5" role="group" aria-label="What to include">
            {SECTION_ORDER.map((key) => (
              <Chip
                key={key}
                active={sections[key]}
                onClick={() => setSections((s) => ({ ...s, [key]: !s[key] }))}
              >
                {SECTION_LABELS[key]}
              </Chip>
            ))}
            {setupSnapshotId ? (
              <Chip active={includeSetup} onClick={() => setIncludeSetup((v) => !v)}>
                Setup sheet
                {/* It adds a second FILE rather than a section — say so on the chip. */}
                <span className="font-normal text-faint">+1 pic</span>
              </Chip>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 pt-1">
          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
          {skipped ? <p className="text-[12px] text-muted-foreground">{skipped}</p> : null}
          {state === "downloaded" ? (
            <p className="text-[12px] text-muted-foreground">
              Saved to your downloads — this browser can&apos;t open the share sheet.
            </p>
          ) : null}
          {/* The app's own primary chip — yellow fill, dark ink, glow — not a hand-rolled one.
              Written out by hand first, it came out unfilled in both themes: `primary-action-chip`
              is the type and geometry, and `primaryButtonClassName` is what carries the fill. */}
          <button
            type="button"
            disabled={busy}
            // Called straight, not through an async wrapper: `share` reaches `navigator.share()`
            // synchronously so iOS still counts this tap as the gesture that asked for it.
            onClick={() => share(targets, { title: runLabel, text: runLabel })}
            className={primaryButtonClassName(
              "primary-action-chip-prominent w-full disabled:cursor-not-allowed disabled:opacity-60"
            )}
          >
            <span className="primary-action-chip-content">
              {busy ? (
                <>
                  <Spinner /> Drawing…
                </>
              ) : (
                <>
                  <Share2 className="primary-action-chip-icon" strokeWidth={2} aria-hidden />
                  {sendLabel}
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * The shipped chip treatment, plus one addition: a tick when it is on. Active is still raised
 * neutral, never yellow — selection is state, and yellow means action.
 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        chipToggleClass(active),
        "tap-active inline-flex items-center gap-1.5 px-[11px] py-[9px] text-[12.5px]"
      )}
    >
      {active ? <Check className="size-3 shrink-0" strokeWidth={3} aria-hidden /> : null}
      {children}
    </button>
  );
}
