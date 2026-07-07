"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
  type ReactNode,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Apple-widget-style paged card region: one card slot, several designed "faces"
 * of the same subject, swiped horizontally. iOS-convention chrome — pagination
 * dots (ink active / faint inactive; yellow stays action-only), rubber-band edge
 * resistance, hover chevrons on desktop. The card's height is fixed by its
 * tallest face so the page never jumps while swiping.
 *
 * Place this INSIDE the card surface (`SurfaceCard` / `CardPanel`); it pages the
 * content region, not the card frame. The last-viewed face is remembered per
 * card per device (localStorage, keyed by face id so reordering faces is safe).
 */

export type PagedCardFace = {
  /** Stable id — persisted as the remembered face; don't rename casually. */
  id: string;
  /** Short human label for dot / chevron aria-labels ("Per-track pace"). */
  label: string;
  content: ReactNode;
};

/** How far (fraction of card width) a drag must travel to commit a page turn. */
const COMMIT_FRACTION = 0.25;
/** Or how fast (px/ms) a flick must be to commit regardless of distance. */
const COMMIT_VELOCITY = 0.4;
/** Movement (px) before a pointer drag is claimed as a horizontal swipe. */
const CLAIM_DISTANCE = 8;
/** Accumulated trackpad deltaX required to page. */
const WHEEL_STEP = 80;
/** Ignore wheel input for this long after a wheel page (inertial-scroll guard). */
const WHEEL_LOCK_MS = 500;

function storageKeyFor(id: string): string {
  return `pagedCard:${id}`;
}

export function PagedCard({
  storageKey,
  faces,
  className,
}: {
  /** Unique per card placement — namespaces the remembered face. */
  storageKey: string;
  faces: PagedCardFace[];
  className?: string;
}) {
  const count = faces.length;
  const [rawIndex, setRawIndex] = useState(0);
  const index = Math.max(0, Math.min(count - 1, rawIndex));
  const [dragPx, setDragPx] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** Off until the remembered face is restored, so the first paint doesn't animate. */
  const [animate, setAnimate] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastT: number;
    /** Smoothed horizontal velocity, px/ms. */
    vx: number;
    claimed: boolean;
  } | null>(null);
  /** Swallow the click that follows a completed swipe (faces may be link overlays). */
  const suppressClickRef = useRef(false);
  const wheelAccumRef = useRef(0);
  const wheelLockUntilRef = useRef(0);

  useEffect(() => {
    try {
      const savedId = window.localStorage.getItem(storageKeyFor(storageKey));
      if (savedId) {
        const i = faces.findIndex((f) => f.id === savedId);
        if (i > 0) setRawIndex(i);
      }
    } catch {
      /* storage unavailable (private mode) — always fall back to face 1 */
    }
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
    // Restore once on mount only — faces identity churn must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(count - 1, i));
      setRawIndex(next);
      const face = faces[next];
      if (face) {
        try {
          window.localStorage.setItem(storageKeyFor(storageKey), face.id);
        } catch {
          /* non-fatal */
        }
      }
    },
    [count, faces, storageKey]
  );

  const endGesture = useCallback(
    (commit: boolean) => {
      const g = gestureRef.current;
      gestureRef.current = null;
      setDragging(false);
      if (!g || !g.claimed) {
        setDragPx(0);
        return;
      }
      suppressClickRef.current = true;
      if (commit) {
        const width = viewportRef.current?.clientWidth ?? 1;
        setDragPx((drag) => {
          const passedDistance = Math.abs(drag) > width * COMMIT_FRACTION;
          const flicked = Math.abs(g.vx) > COMMIT_VELOCITY && Math.sign(g.vx) === Math.sign(drag);
          if (passedDistance || flicked) {
            // drag < 0 means content moved left → next face.
            goTo(index + (drag < 0 ? 1 : -1));
          }
          return 0;
        });
      } else {
        setDragPx(0);
      }
    },
    [goTo, index]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (count < 2) return;
      // Primary button / single touch only.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      gestureRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastT: e.timeStamp,
        vx: 0,
        claimed: false,
      };
      suppressClickRef.current = false;
    },
    [count]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (!g.claimed) {
        if (Math.abs(dx) < CLAIM_DISTANCE) return;
        // Vertical intent → let the page scroll (touch-action: pan-y owns it).
        if (Math.abs(dy) > Math.abs(dx)) {
          gestureRef.current = null;
          return;
        }
        g.claimed = true;
        setDragging(true);
        e.currentTarget.setPointerCapture(e.pointerId);
      }

      const dt = Math.max(1, e.timeStamp - g.lastT);
      g.vx = 0.8 * ((e.clientX - g.lastX) / dt) + 0.2 * g.vx;
      g.lastX = e.clientX;
      g.lastT = e.timeStamp;

      // Rubber-band: past either end, the card resists (iOS-style) instead of paging.
      const atStart = index === 0 && dx > 0;
      const atEnd = index === count - 1 && dx < 0;
      setDragPx(atStart || atEnd ? dx / 3 : dx);
    },
    [count, index]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      endGesture(true);
    },
    [endGesture]
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gestureRef.current;
      if (!g || e.pointerId !== g.pointerId) return;
      endGesture(false);
    },
    [endGesture]
  );

  const onClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  /** Trackpad horizontal scroll pages too (desktop parity with swipe). */
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (count < 2) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const now = e.timeStamp;
      if (now < wheelLockUntilRef.current) {
        wheelAccumRef.current = 0;
        return;
      }
      wheelAccumRef.current += e.deltaX;
      if (Math.abs(wheelAccumRef.current) >= WHEEL_STEP) {
        const dir = wheelAccumRef.current > 0 ? 1 : -1;
        wheelAccumRef.current = 0;
        wheelLockUntilRef.current = now + WHEEL_LOCK_MS;
        goTo(index + dir);
      }
    },
    [count, goTo, index]
  );

  if (count === 0) return null;
  if (count === 1) return <div className={className}>{faces[0].content}</div>;

  return (
    <div className={cn("group/paged relative", className)}>
      <div
        ref={viewportRef}
        className={cn("overflow-hidden", dragging && "select-none")}
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClickCapture={onClickCapture}
        onWheel={onWheel}
        onDragStart={(e) => e.preventDefault()}
      >
        <div
          className={cn(
            "flex items-stretch",
            animate && !dragging && "transition-transform duration-300 ease-out"
          )}
          style={{ transform: `translate3d(calc(${-index * 100}% + ${dragPx}px), 0, 0)` }}
        >
          {faces.map((face, i) => (
            <div
              key={face.id}
              className="relative w-full min-w-0 shrink-0"
              aria-hidden={i !== index}
              inert={i !== index ? true : undefined}
            >
              {face.content}
            </div>
          ))}
        </div>
      </div>

      {/* Desktop chevrons — revealed on hover / keyboard focus; edges hide their side. */}
      {index > 0 ? (
        <button
          type="button"
          aria-label={`Show ${faces[index - 1].label}`}
          onClick={() => goTo(index - 1)}
          className="absolute left-0 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-lg border border-border bg-card/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover/paged:opacity-100 sm:flex"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
      {index < count - 1 ? (
        <button
          type="button"
          aria-label={`Show ${faces[index + 1].label}`}
          onClick={() => goTo(index + 1)}
          className="absolute right-0 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-lg border border-border bg-card/85 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 group-hover/paged:opacity-100 sm:flex"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

      {/* Pagination dots — ink active / faint inactive; the discovery affordance. */}
      <div className="mt-2 flex items-center justify-center">
        {faces.map((face, i) => (
          <button
            key={face.id}
            type="button"
            aria-label={`Show ${face.label}`}
            aria-current={i === index ? "true" : undefined}
            onClick={() => goTo(i)}
            className="group/dot p-1 focus-visible:outline-none"
          >
            <span
              className={cn(
                "block h-1.5 w-1.5 rounded-full transition-colors",
                i === index
                  ? "bg-foreground"
                  : "bg-foreground/25 group-hover/dot:bg-foreground/50 group-focus-visible/dot:bg-foreground/50"
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
