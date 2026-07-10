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
import { cn } from "@/lib/utils";

/**
 * Apple-widget-style paged card region: one card slot, several designed "faces"
 * of the same subject, swiped horizontally. A labeled segmented control below
 * the content names every face and switches to it on tap (the discovery
 * affordance — replaced the old pagination dots 2026-07-10); swipe, trackpad
 * scroll, and rubber-band edge resistance still work. The card's height is fixed
 * by its tallest face so the page never jumps while swiping.
 *
 * Place this INSIDE the card surface (`SurfaceCard` / `CardPanel`); it pages the
 * content region, not the card frame. The last-viewed face is remembered per
 * card per device (localStorage, keyed by face id so reordering faces is safe).
 */

export type PagedCardFace = {
  /** Stable id — persisted as the remembered face; don't rename casually. */
  id: string;
  /** Full human label for aria ("Per-track pace"). */
  label: string;
  /** Terse label for the segmented control; falls back to `label`. Keep ≤ ~10 chars. */
  shortLabel?: string;
  /** Extra classes on this face's segment button (e.g. an attention ring). */
  controlClassName?: string;
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
  controlPosition = "below",
  heightMode = "tallest",
  activeId,
  onActiveIdChange,
}: {
  /** Unique per card placement — namespaces the remembered face. */
  storageKey: string;
  faces: PagedCardFace[];
  className?: string;
  /** "below" is the dashboard widget style; "above" reads as a mode picker for form sections. */
  controlPosition?: "above" | "below";
  /**
   * "tallest" locks the card to its tallest face (dashboard — the page never
   * jumps while swiping); "adaptive" animates to each face's own height so
   * short form faces don't leave dead space.
   */
  heightMode?: "tallest" | "adaptive";
  /**
   * Controlled mode: the active face id. Pair with `onActiveIdChange` when the
   * face IS a piece of form state (e.g. setup source). Disables face memory.
   */
  activeId?: string;
  onActiveIdChange?: (id: string) => void;
}) {
  const count = faces.length;
  const controlled = activeId !== undefined;
  const [rawIndex, setRawIndex] = useState(0);
  const controlledIndex = controlled ? faces.findIndex((f) => f.id === activeId) : -1;
  const index = Math.max(0, Math.min(count - 1, controlled ? Math.max(0, controlledIndex) : rawIndex));
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
    if (!controlled) {
      try {
        const savedId = window.localStorage.getItem(storageKeyFor(storageKey));
        if (savedId) {
          const i = faces.findIndex((f) => f.id === savedId);
          if (i > 0) setRawIndex(i);
        }
      } catch {
        /* storage unavailable (private mode) — always fall back to face 1 */
      }
    }
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(raf);
    // Restore once on mount only — faces identity churn must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(count - 1, i));
      const face = faces[next];
      if (controlled) {
        // Controlled faces are form state — the owner decides; nothing is remembered.
        if (face) onActiveIdChange?.(face.id);
        return;
      }
      setRawIndex(next);
      if (face) {
        try {
          window.localStorage.setItem(storageKeyFor(storageKey), face.id);
        } catch {
          /* non-fatal */
        }
      }
    },
    [count, faces, storageKey, controlled, onActiveIdChange]
  );

  /** Adaptive height: track the active face's own height (incl. its content resizing). */
  const faceRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [adaptiveHeight, setAdaptiveHeight] = useState<number | null>(null);
  useEffect(() => {
    if (heightMode !== "adaptive") return;
    const el = faceRefs.current[index];
    if (!el) return;
    const measure = () => setAdaptiveHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [heightMode, index, count]);

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
        const passedDistance = Math.abs(dragPx) > width * COMMIT_FRACTION;
        const flicked = Math.abs(g.vx) > COMMIT_VELOCITY && Math.sign(g.vx) === Math.sign(dragPx);
        if (passedDistance || flicked) {
          // drag < 0 means content moved left → next face. Outside the setDragPx
          // updater: goTo may call a controlled owner's callback (a side effect).
          goTo(index + (dragPx < 0 ? 1 : -1));
        }
      }
      setDragPx(0);
    },
    [goTo, index, dragPx]
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (count < 2) return;
      // Primary button / single touch only.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Drags starting inside a text control belong to the control (cursor
      // placement / text selection), never to paging.
      if (
        e.target instanceof Element &&
        e.target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
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

  const adaptive = heightMode === "adaptive";

  /* Segmented control — names each face and switches to it; the discovery
     affordance that replaced pagination dots. Yellow stays action-only, so
     the active segment reads as a raised neutral chip, not the accent. */
  const control = (
    <div
      role="tablist"
      aria-label="Card views"
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-border bg-background/45 p-0.5",
        controlPosition === "above" ? "mb-3" : "mt-3"
      )}
    >
      {faces.map((face, i) => {
        const active = i === index;
        return (
          <button
            key={face.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={`Show ${face.label}`}
            onClick={() => goTo(i)}
            className={cn(
              "min-w-0 flex-1 truncate rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              active
                ? "bg-muted text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                : "text-muted-foreground hover:text-foreground",
              face.controlClassName
            )}
          >
            {face.shortLabel ?? face.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={cn("relative", className)}>
      {controlPosition === "above" ? control : null}
      <div
        ref={viewportRef}
        className={cn(
          "overflow-hidden",
          dragging && "select-none",
          adaptive && animate && !dragging && "transition-[height] duration-300 ease-out"
        )}
        style={{
          touchAction: "pan-y",
          height: adaptive && adaptiveHeight != null ? adaptiveHeight : undefined,
        }}
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
            "flex",
            // Adaptive: each face keeps its natural height so the viewport can
            // hug the active one; tallest: stretch so the card never jumps.
            adaptive ? "items-start" : "items-stretch",
            animate && !dragging && "transition-transform duration-300 ease-out"
          )}
          style={{ transform: `translate3d(calc(${-index * 100}% + ${dragPx}px), 0, 0)` }}
        >
          {faces.map((face, i) => (
            <div
              key={face.id}
              ref={(el) => {
                faceRefs.current[i] = el;
              }}
              className="relative w-full min-w-0 shrink-0"
              aria-hidden={i !== index}
              inert={i !== index ? true : undefined}
            >
              {face.content}
            </div>
          ))}
        </div>
      </div>
      {controlPosition === "below" ? control : null}
    </div>
  );
}
