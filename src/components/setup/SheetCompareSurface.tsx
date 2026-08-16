"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SheetFillSurface } from "@/components/setup/SheetFillSurface";
import { SheetGeometryStrip } from "@/components/rollCenter/SheetGeometryStrip";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { storedValuesToSurface } from "@/lib/setupSheetModels/sheetSurfaceValues";

/**
 * Two setups compared BY FLIPPING between them on one sheet.
 *
 * ============================== WHY NOTHING IS DRAWN ON THE PAPER ==============================
 *
 * Every earlier version of setup compare marked the changed fields — a red tint whose darkness
 * scaled with community spread, a `vs 13.0` printed under each value, a severity tally. Founder
 * ruling 2026-08-14: none of it. The paper stays the driver's own printed sheet.
 *
 * What replaces it is registration. Both setups draw into the SAME boxes at the SAME size on the
 * SAME page picture, so flipping from one to the other moves only the values that differ. On a
 * still page the changed boxes are the only thing that is not still, and the eye finds them
 * without being told. It is the blink comparator, and it needs no ink at all.
 *
 * That makes the view state load-bearing. Zoom, pan and page number live inside `SheetFillSurface`
 * and MUST survive the flip untouched — which is why the other setup arrives as a second value set
 * (`alternateValues`) rather than as a re-render or a remount. A view that shifts by one pixel
 * between the two sides makes every box look like it moved, which is exactly the signal being read.
 *
 * ============================== THE TWO GESTURES ==============================
 *
 * HOLD TO PEEK is the reading gesture: press and hold, the other setup is on the paper for as long
 * as you hold, release and you are back. Momentary, so repeat flips are fast and you can never be
 * left looking at the wrong sheet without knowing it.
 *
 * THE SWITCH is the deliberate act: it sets which setup is on top. Peek always shows the other one,
 * whichever that currently is, so the pair stays symmetric.
 */

/** How long a still press on the paper waits before it peeks. */
const PEEK_HOLD_MS = 180;
/**
 * How far the pointer may travel and still count as a hold.
 *
 * The paper underneath pans on drag, so this is the line between the two gestures: move and you are
 * panning, stay still and you are peeking. Matches the fill surface's own tap slop.
 */
const PEEK_SLOP_PX = 8;

export type CompareSide = {
  /** Whose setup this is, in the driver's words — "Sat 09 Aug · MR33 Arena", not "A". */
  label: string;
  /** The snapshot's data as stored — arrays, preset objects, numbers. */
  values: Record<string, unknown>;
};

export function SheetCompareSurface({
  setupSheetModelId,
  editionBlankId,
  a,
  b,
  templateKey,
  className,
}: {
  setupSheetModelId: string;
  /**
   * The EDITION side A draws on, when not the primary blank. One paper for both sides — flipping
   * is the whole design — so side B's values show only where its keys exist on this sheet.
   */
  editionBlankId?: string | null;
  a: CompareSide;
  b: CompareSide;
  /** Chassis-type key. Without it there is no geometry strip — see `SheetGeometryStrip`. */
  templateKey?: string | null;
  className?: string;
}) {
  /** Which setup is resting on top. The switch sets this; peek never changes it. */
  const [onTop, setOnTop] = useState<"a" | "b">("a");
  const [peeking, setPeeking] = useState(false);

  const other = onTop === "a" ? "b" : "a";
  const shown = peeking ? other : onTop;

  /*
   * Side A is ALWAYS `initialValues` and side B is ALWAYS `alternateValues`; which one draws is a
   * boolean. `SheetFillSurface` seeds its value state from `initialValues` exactly once, so a prop
   * that changed identity per flip would either be ignored or force a remount — and a remount
   * resets zoom, pan and page, which is the one thing this component exists to prevent.
   */
  const surfaceA = useMemo(() => storedValuesToSurface(a.values), [a.values]);
  const surfaceB = useMemo(() => storedValuesToSurface(b.values), [b.values]);

  const shownSide = shown === "a" ? a : b;

  /* ── hold to peek ────────────────────────────────────────────────────────── */

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdStart = useRef<{ x: number; y: number } | null>(null);
  /** Lives for one hold, and drops its window listeners when the hold ends however it ends. */
  const holdAbort = useRef<AbortController | null>(null);

  /** Everything a hold leaves behind: the timer, the start point, the window listeners. */
  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    holdStart.current = null;
    holdAbort.current?.abort();
    holdAbort.current = null;
  }, []);

  const release = useCallback(() => {
    clearHold();
    setPeeking(false);
  }, [clearHold]);

  /**
   * Arm a hold. From the paper it waits, so a drag can still be a pan; from the button it peeks at
   * once, because a button press has no other meaning.
   *
   * The window listeners go on NOW rather than once the peek is showing: a pointer lifted during
   * the wait sends its `pointerup` somewhere we would not be listening, and the timer would then
   * fire onto a finger that is no longer down — a peek stuck on with nothing holding it.
   */
  const armHold = useCallback(
    (point?: { x: number; y: number }) => {
      clearHold();
      holdStart.current = point ?? null;
      const ac = new AbortController();
      holdAbort.current = ac;
      window.addEventListener("pointerup", release, { signal: ac.signal });
      window.addEventListener("pointercancel", release, { signal: ac.signal });
      holdTimer.current = setTimeout(
        () => {
          holdTimer.current = null;
          setPeeking(true);
        },
        point ? PEEK_HOLD_MS : 0
      );
    },
    [clearHold, release]
  );

  // Unmounting mid-hold must not leave a timer or two window listeners behind.
  useEffect(() => clearHold, [clearHold]);

  const onPaperPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Left button / touch / pen only — a right-click is the context menu, not a peek.
      if (e.button !== 0) return;
      armHold({ x: e.clientX, y: e.clientY });
    },
    [armHold]
  );

  const onPaperPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = holdStart.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > PEEK_SLOP_PX) {
        // Moved: this is a pan, not a hold. Give the gesture back to the sheet.
        release();
      }
    },
    [release]
  );

  /** Peek always shows the other one, so the button names it whether or not it is being held. */
  const otherLabel = onTop === "a" ? b.label : a.label;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Chrome above the paper, never ink on it — the strip belongs to whichever sheet is shown. */}
      <SheetGeometryStrip
        value={shownSide.values}
        templateKey={templateKey}
        editionBlankId={editionBlankId}
      />

      <div className="flex items-center gap-2">
        <SegmentedControl
          size="sm"
          className="min-w-0 flex-1"
          segmentClassName="min-w-0 px-2"
          ariaLabel="Which setup is on top"
          value={onTop}
          onChange={setOnTop}
          options={[
            { value: "a", ariaLabel: a.label, label: <span className="truncate">{a.label}</span> },
            { value: "b", ariaLabel: b.label, label: <span className="truncate">{b.label}</span> },
          ]}
        />
        <button
          type="button"
          // Not a toggle: it is held. `aria-pressed` reports the held state for the duration.
          aria-pressed={peeking}
          aria-label={`Hold to see ${otherLabel} on this sheet`}
          title="Hold to see the other setup on this sheet — release to come back"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            armHold();
          }}
          onPointerUp={release}
          onPointerLeave={release}
          // Space and enter behave the same way: held, not toggled.
          onKeyDown={(e) => {
            if (e.repeat) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              armHold();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") release();
          }}
          // A button that loses focus mid-hold would otherwise strand the sheet on the other setup.
          onBlur={release}
          className={cn(
            "tap-active shrink-0 select-none rounded-lg border px-3 py-1.5 text-xs font-medium transition",
            peeking
              ? "border-primary-ink/50 bg-muted/60 text-foreground"
              : "border-border bg-card text-muted-foreground hover:border-primary-ink/40 hover:text-foreground"
          )}
        >
          Peek
        </button>
      </div>

      {/*
        The paper. Pointer handlers sit on the wrapper and never call `preventDefault`, so the
        events still reach the sheet underneath and pan and pinch keep working — the hold timer is
        what separates the two gestures. `select-none` because a long press on text selects it
        instead, and the context menu is suppressed for the same reason.
      */}
      <div
        onPointerDown={onPaperPointerDown}
        onPointerMove={onPaperPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => {
          if (peeking) e.preventDefault();
        }}
        className="select-none"
      >
        <SheetFillSurface
          planUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-plan${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
          pageImageUrl={`/api/setup-sheet-models/${setupSheetModelId}/sheet-page${editionBlankId ? `?blank=${encodeURIComponent(editionBlankId)}` : ""}`}
          initialValues={surfaceA}
          alternateValues={surfaceB}
          showAlternate={shown === "b"}
          readOnly
        />
      </div>

      {/*
        Which setup is actually on the paper right now. During a peek this disagrees with the
        switch above — deliberately, because the switch says what you will return to and this says
        what you are looking at. Fixed height so the flip never reflows the page.
      */}
      <p className="flex h-4 items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
        <span className="type-data-label shrink-0">On the sheet</span>
 <span className="min-w-0 truncate tabular-nums text-foreground">
          {shownSide.label}
        </span>
      </p>
    </div>
  );
}
