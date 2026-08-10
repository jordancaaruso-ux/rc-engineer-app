"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

/**
 * Filling in the manufacturer's own setup sheet, on a phone.
 *
 * THE PROBLEM THIS SOLVES. A4 at 390 px wide puts a setup sheet's boxes about six pixels tall.
 * Zoomed out you can see the sheet but you cannot possibly type into it; zoomed in you can type
 * but you have to pan around hunting for the next box.
 *
 * THE SHAPE. One rendered page you can pinch and drag, plus a bar docked under it.
 *
 *  - **Overview** — the whole page, boxes tinted by whether they are filled. Tapping a box focuses
 *    it. Pinching zooms in on whatever you are looking at.
 *  - **Focused** — the page slides so one box sits above the bar, and you type in the bar. Next and
 *    back step in reading order, keeping whatever zoom you chose, so the sheet never jumps scale
 *    underneath you.
 *
 * THREE THINGS LEARNED FROM DRIVING IT ON A PHONE (2026-08-10):
 *
 *  1. **Auto-zoom was far too aggressive.** Scaling by the box's own width meant a tick box filled
 *     the screen — no surrounding print, so no way to tell which tick box you were on. Focus now
 *     moves to a modest fixed zoom that keeps the row and its printed caption in view, and the
 *     driver pinches from there if they want more.
 *  2. **The zoom must be the driver's, not ours.** Stepping to the next box keeps the current
 *     scale and only pans. Re-deciding the zoom on every step is what made it feel like being
 *     dragged around.
 *  3. **The keyboard must not move the page.** When focused this goes fullscreen and stops the
 *     document scrolling, and the sheet area is sized from `visualViewport` — so the keyboard
 *     appears over the bottom of the screen and the sheet simply gets shorter. Nothing slides.
 *
 * AND ONE MORE, 2026-08-10 (second phone drive):
 *
 *  4. **The keyboard must not come and go either.** Stepping from a tick box to a text box used to
 *     swap the control in the bar, so the keyboard closed and reopened — half a second of the
 *     screen resizing twice, on every such step. There is now ONE input, mounted for as long as
 *     any box is focused and never blurred: on a tick box it sits invisible behind the tick
 *     control, and every button in the bar refuses focus so it can never steal it. The keyboard
 *     comes up on the first box and stays up until Done.
 *
 * VALUES ARE DRAWN THE WAY THE PDF ASKS. Font, size, colour, alignment and the tick mark itself
 * all come from the file's own form layer — see `pdfFieldAppearance`. Filling a sheet here should
 * be indistinguishable from filling it in Acrobat, because credibility is the point: it is the
 * driver's own sheet, and it has to keep looking like it.
 */

export type SheetFillBoxStyle = {
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  color: string;
  alignment: "left" | "center" | "right";
  /** Fraction of the page height. 0 means auto — size it to the box. */
  fontSizeFrac: number;
  /** Tick boxes: the mark this box makes. Not always a check. */
  checkMark?: string;
};

export type SheetFillBox = {
  key: string;
  pageNumber: number;
  /** Fractions of the page, from its top-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  style?: SheetFillBoxStyle;
};

export type SheetFillField = {
  key: string;
  label: string;
  /** True when the label is a position, not a name — nobody has said what this box is yet. */
  unnamed: boolean;
  uiType: "text" | "checkbox";
  sectionTitle: string;
  options?: string[];
};

export type SheetFillPlan = {
  fields: SheetFillField[];
  boxes: SheetFillBox[];
  pageCount: number;
};

const EMPTY_PLAN: SheetFillPlan = { fields: [], boxes: [], pageCount: 1 };

/**
 * Zoom, as a multiple of the page fitted to the screen's width.
 *
 * `FOCUS_ZOOM` is what tapping a box gives you: enough to read the printed caption beside it while
 * still seeing the rows above and below, which is how you know you are on the right box. It used
 * to be computed from the box's own size and reached 9x on a tick box — a screenful of one empty
 * square. Anything more than this is the driver's own pinch.
 */
const FIT_ZOOM = 1;
const FOCUS_ZOOM = 2.3;
const MAX_ZOOM = 8;
/** Below this a drag is a tap, not a pan — thumbs are not steady on a pit table. */
const TAP_SLOP_PX = 8;

/**
 * Acrobat's own field highlight — the pale blue wash it puts behind every fillable box.
 *
 * Kept because it is the thing that tells a driver at a glance which parts of the paper they are
 * meant to fill in, and because it is what they already see in every PDF reader. Translucent so the
 * printed rules and captions underneath stay readable.
 */
const FIELD_TINT = "rgba(186, 211, 242, 0.5)";
const FIELD_TINT_BORDER = "rgba(112, 152, 200, 0.55)";

/**
 * The box you are on, in the app's action colour.
 *
 * It has to carry at a glance on a sheet of two hundred near-identical pale blue boxes, and the box
 * itself can be six pixels tall zoomed out — so the halo does the work, not the border. The halo is
 * drawn outside the box, which means it is still visible when the box is too small to have an
 * inside worth looking at.
 */
const FOCUS_TINT = "rgba(255, 214, 10, 0.42)";
const FOCUS_HALO = "0 0 0 2px rgba(255, 214, 10, 0.95), 0 0 0 5px rgba(255, 214, 10, 0.18)";

/** A viewer sizes an auto-sized value to the box; this is that, near enough to read the same. */
const AUTO_TEXT_HEIGHT_RATIO = 0.66;
const AUTO_MARK_HEIGHT_RATIO = 0.78;

const DEFAULT_BOX_STYLE: SheetFillBoxStyle = {
  fontFamily: "Helvetica, Arial, sans-serif",
  bold: false,
  italic: false,
  color: "#000000",
  alignment: "left",
  fontSizeFrac: 0,
};

/** Stops a button in the bar taking focus off the input, which would close the keyboard. */
function keepKeyboard(e: React.MouseEvent) {
  e.preventDefault();
}

/** Roughly how wide a character is, as a share of its size, in the fonts these sheets use. */
const AVERAGE_ADVANCE = 0.55;

/**
 * The size a viewer picks when the field says `0 Tf` — big enough to read, small enough to fit.
 *
 * Sizing by the box's height alone is not enough: setup-sheet boxes are short and narrow, so "0.5"
 * at two-thirds of the box height overflows a bump-steer box and gets cut off. A viewer shrinks the
 * text until the whole value fits, and so does this.
 */
function autoFontSize(text: string, boxWidth: number, boxHeight: number, isTick: boolean): number {
  const byHeight = boxHeight * (isTick ? AUTO_MARK_HEIGHT_RATIO : AUTO_TEXT_HEIGHT_RATIO);
  const chars = Math.max(text.length, 1);
  const inner = Math.max(boxWidth - 2, 1);
  const byWidth = inner / (chars * AVERAGE_ADVANCE);
  return Math.max(Math.min(byHeight, byWidth), 3);
}

/** Structural, so it takes both React's synthetic touches and the DOM's. */
function distance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function SheetFillSurface({
  pageImageUrl,
  planUrl,
  initialValues,
  onChange,
  storageKey,
}: {
  /** Returns an image of one page; the page number is appended as `page=`. */
  pageImageUrl: string;
  /**
   * Returns `{ fields, boxes, pageCount }` as JSON, fetched by the browser.
   *
   * Deliberately fetched rather than passed in as a prop. A 200-box sheet is a large value, and a
   * large value handed to the browser as a page prop travels through Next's streaming page format
   * — whose decoder, in development, breaks when one value spans chunk boundaries. That failed
   * about one page load in three with 289 boxes, and never with 15.
   */
  planUrl: string;
  initialValues?: Record<string, string>;
  onChange?: (values: Record<string, string>) => void;
  /** When set, values survive a reload — a sheet is filled over a whole day, not in one sitting. */
  storageKey?: string;
}) {
  const [plan, setPlan] = useState<SheetFillPlan>(EMPTY_PLAN);
  const [planError, setPlanError] = useState<string | null>(null);
  const { fields, boxes, pageCount } = plan;

  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  /** Page size when fitted to the stage width, in CSS pixels. */
  const [fitted, setFitted] = useState({ width: 0, height: 0 });
  /** What the driver is looking at: zoom, and where the page's top-left sits on the stage. */
  const [view, setView] = useState({ zoom: FIT_ZOOM, x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);

  const [stage, setStage] = useState({ width: 0, height: 0 });
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const boxByKey = useMemo(() => new Map(boxes.map((b) => [b.key, b])), [boxes]);
  /** Reading order is the order the fields arrive in — the derivation already sorted them. */
  const order = useMemo(() => fields.filter((f) => boxByKey.has(f.key)), [fields, boxByKey]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const focused = focusIndex === null ? null : order[focusIndex] ?? null;
  const focusedBox = focused ? boxByKey.get(focused.key) ?? null : null;
  const isFocusMode = focusIndex !== null;
  /** True when this box is typed into. A tick box and a choice row are tapped, not typed. */
  const typesValues = focused ? focused.uiType !== "checkbox" && !focused.options?.length : false;

  // --- the box list ----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch(planUrl, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sheet unavailable (${res.status})`);
        return (await res.json()) as SheetFillPlan;
      })
      .then((p) => {
        if (cancelled) return;
        setPlan({ fields: p.fields ?? [], boxes: p.boxes ?? [], pageCount: p.pageCount || 1 });
      })
      .catch((e: unknown) => {
        if (!cancelled) setPlanError(e instanceof Error ? e.message : "Couldn’t load this sheet");
      });
    return () => {
      cancelled = true;
    };
  }, [planUrl]);

  // --- restore / persist -----------------------------------------------------------------
  /**
   * The browser copy fills in the gaps; it never overrules what the caller was given.
   *
   * This used to replace `values` outright, which was harmless only while nothing was persisted
   * anywhere. Once a caller passes a saved setup in, an old copy sitting in this browser from some
   * earlier sitting would overwrite it — and the driver would watch a setup they saved turn back
   * into one they had abandoned.
   *
   * So a key the caller supplied wins, always. The worst case becomes losing the last few seconds
   * of typing, instead of losing a saved sheet.
   */
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, string>;
      setValues((current) => ({ ...stored, ...current }));
    } catch {
      /* a corrupt draft is not worth blocking the sheet for */
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(values));
    } catch {
      /* out of quota — the sheet still works for this sitting */
    }
  }, [storageKey, values]);

  /**
   * Measure the stage the sheet is drawn into.
   *
   * A callback ref, not an effect, because the box list arrives by fetch: while it is loading this
   * component renders a placeholder instead of the stage, so a mount-time effect looks for an
   * element that does not exist yet and never runs again — the sheet then never gets a width and
   * the page image is never requested.
   */
  const observerRef = useRef<ResizeObserver | null>(null);
  const attachStage = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    stageElRef.current = el;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  /**
   * Height available once the keyboard is up.
   *
   * `visualViewport` is the only thing that knows. Without it the sheet keeps its full height, iOS
   * scrolls the document to reveal the focused input, and the whole screen slides — which is
   * exactly what looked wrong on the phone.
   */
  const [visualHeight, setVisualHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;
    const onResize = () => setVisualHeight(vv.height);
    onResize();
    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, []);

  /** While focused this owns the screen, so nothing behind it can scroll under the keyboard. */
  useEffect(() => {
    if (!isFocusMode || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFocusMode]);

  // --- panning the page ------------------------------------------------------------------

  /**
   * Keep the page filling the stage, with no dead space at its edges.
   *
   * An earlier version only kept a fraction of the page on screen, which let a box near the top of
   * the sheet leave a third of the screen blank above it. If the page is bigger than the stage its
   * edges may not come inside; if it is smaller it sits centred.
   */
  const clampView = useCallback(
    (next: { zoom: number; x: number; y: number }) => {
      const w = fitted.width * next.zoom;
      const h = fitted.height * next.zoom;
      if (!w || !h || !stage.width || !stage.height) return next;
      return {
        zoom: next.zoom,
        x: w <= stage.width
          ? (stage.width - w) / 2
          : Math.min(0, Math.max(stage.width - w, next.x)),
        y: h <= stage.height
          ? (stage.height - h) / 2
          : Math.min(0, Math.max(stage.height - h, next.y)),
      };
    },
    [fitted, stage]
  );

  /** Put a box in the readable band above the docked bar, at whatever zoom is in use. */
  const viewCentredOn = useCallback(
    (box: SheetFillBox, zoom: number) => {
      const cx = (box.x + box.width / 2) * fitted.width;
      const cy = (box.y + box.height / 2) * fitted.height;
      return clampView({
        zoom,
        x: stage.width / 2 - cx * zoom,
        // A little above centre: the printed caption usually sits left of or above the box.
        y: stage.height * 0.45 - cy * zoom,
      });
    },
    [fitted, stage, clampView]
  );

  /**
   * Re-settle the view once the page's real size is known.
   *
   * The page arrives as an image, so its height is unknown on the first render and the view starts
   * at the top-left corner. On a landscape sheet that left the page pinned to the top of a taller
   * stage with dead space under it.
   */
  useEffect(() => {
    if (!fitted.width || !stage.width) return;
    setView((v) => clampView(v));
  }, [fitted, stage, clampView]);

  // Follow the focused box onto its own page, then pan to it — keeping the driver's zoom.
  useEffect(() => {
    if (!focusedBox) return;
    if (focusedBox.pageNumber !== page) setPage(focusedBox.pageNumber);
    if (!fitted.width || !stage.width) return;
    setAnimate(true);
    setView((v) => viewCentredOn(focusedBox, Math.max(v.zoom, FOCUS_ZOOM)));
    // The current zoom is read inside the updater, never as a dependency — depending on it would
    // re-run this on every pinch and fight the driver for control of the zoom.
  }, [focusedBox, fitted.width, stage.width, page, viewCentredOn]);

  const gesture = useRef<{
    mode: "none" | "pan" | "pinch";
    startX: number;
    startY: number;
    startView: { zoom: number; x: number; y: number };
    startDistance: number;
    midX: number;
    midY: number;
    moved: number;
  } | null>(null);

  const stagePoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageElRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      setAnimate(false);
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const mid = stagePoint((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
        gesture.current = {
          mode: "pinch",
          startX: 0,
          startY: 0,
          startView: view,
          startDistance: distance(a, b),
          midX: mid.x,
          midY: mid.y,
          moved: 0,
        };
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      gesture.current = {
        mode: "pan",
        startX: t.clientX,
        startY: t.clientY,
        startView: view,
        startDistance: 0,
        midX: 0,
        midY: 0,
        moved: 0,
      };
    },
    [view, stagePoint]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const g = gesture.current;
      if (!g) return;

      if (g.mode === "pinch" && e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const ratio = distance(a, b) / Math.max(g.startDistance, 1);
        const zoom = Math.min(MAX_ZOOM, Math.max(FIT_ZOOM, g.startView.zoom * ratio));
        // Keep whatever was under the fingers under the fingers.
        const pageX = (g.midX - g.startView.x) / g.startView.zoom;
        const pageY = (g.midY - g.startView.y) / g.startView.zoom;
        setView(clampView({ zoom, x: g.midX - pageX * zoom, y: g.midY - pageY * zoom }));
        e.preventDefault();
        return;
      }

      if (g.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0]!;
        const dx = t.clientX - g.startX;
        const dy = t.clientY - g.startY;
        g.moved = Math.max(g.moved, Math.hypot(dx, dy));
        if (g.moved < TAP_SLOP_PX) return; // still might be a tap on a box
        setView(clampView({ zoom: g.startView.zoom, x: g.startView.x + dx, y: g.startView.y + dy }));
        e.preventDefault();
      }
    },
    [clampView]
  );

  const onTouchEnd = useCallback(() => {
    gesture.current = null;
  }, []);

  // --- values ----------------------------------------------------------------------------

  const filledCount = useMemo(
    () => order.filter((f) => (values[f.key] ?? "").trim() !== "").length,
    [order, values]
  );

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  /**
   * Tell the caller after the state has settled, not from inside the updater.
   *
   * `onChange` used to be called inside `setValues`, which updates a parent while React is midway
   * through this component's own update. React runs updaters twice in development to catch exactly
   * that, so the parent saw every keystroke twice — and once a keystroke means a draft written to
   * the server, twice is a wasted round trip per character.
   *
   * The mount run is skipped: handing back the values we were just given is not a change, and a
   * caller that saves on change would write a draft the moment the sheet opened.
   */
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (!notifiedRef.current) {
      notifiedRef.current = true;
      return;
    }
    onChange?.(values);
  }, [values, onChange]);

  const focusBox = useCallback(
    (key: string) => {
      // A drag that ended on a box is a pan, not a tap.
      if ((gesture.current?.moved ?? 0) >= TAP_SLOP_PX) return;
      const i = order.findIndex((f) => f.key === key);
      if (i < 0) return;
      haptic("light");
      setFocusIndex(i);
    },
    [order]
  );

  const step = useCallback(
    (delta: number) => {
      setFocusIndex((i) => {
        if (i === null) return null;
        const next = i + delta;
        if (next < 0 || next >= order.length) return i;
        haptic("light");
        return next;
      });
    },
    [order.length]
  );

  /**
   * Keep the one input focused for as long as any box is focused.
   *
   * Refocusing an element that already has focus does nothing, which is the point: stepping along
   * the sheet never closes the keyboard, so the screen never resizes mid-step.
   */
  useEffect(() => {
    if (focusIndex === null) return;
    const el = inputRef.current;
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    // Land on a filled box and the existing value is selected, so typing replaces it.
    if (typesValues && el.value) el.select();
  }, [focusIndex, typesValues]);

  const exitFocus = useCallback(() => {
    setFocusIndex(null);
    setAnimate(true);
    setView({ zoom: FIT_ZOOM, x: 0, y: 0 });
  }, []);

  const pageBoxes = useMemo(() => boxes.filter((b) => b.pageNumber === page), [boxes, page]);

  if (planError) {
    return (
      <p className="rounded-lg border border-border bg-card p-4 text-sm text-destructive">{planError}</p>
    );
  }
  if (boxes.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-lg border border-border bg-card text-sm text-muted-foreground"
        style={{ height: "62vh" }}
      >
        Opening the sheet…
      </div>
    );
  }

  const sheet = (
    <div
      ref={attachStage}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className={cn(
        "relative flex-1 overflow-hidden bg-[#E8E4DC]",
        !isFocusMode && "rounded-lg border border-border"
      )}
      // `none` so two fingers reach this element instead of scrolling the page. The app disables
      // browser zoom globally, so pinching the sheet has to be handled here or not at all.
      style={{ touchAction: "none", minHeight: 0 }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
          transition: animate ? "transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1)" : "none",
          width: fitted.width || undefined,
        }}
      >
        {/*
          The page is a picture rendered on the server, not a PDF drawn in the browser. That keeps
          a 1.2 MB PDF engine off the driver's phone, caches, and works with no signal.
          `alt` is empty because the boxes drawn over it carry the labels.
        */}
        {stage.width > 0 ? (
          // The page image is sized from the measured stage, so next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${pageImageUrl}${pageImageUrl.includes("?") ? "&" : "?"}page=${page}`}
            alt=""
            width={stage.width}
            onLoad={(e) => {
              const img = e.currentTarget;
              setFitted({
                width: stage.width,
                height: (stage.width / img.naturalWidth) * img.naturalHeight,
              });
            }}
            className="block select-none"
            style={{ width: stage.width, height: "auto" }}
            draggable={false}
          />
        ) : null}

        {fitted.width > 0
          ? pageBoxes.map((b) => {
              const f = fieldByKey.get(b.key);
              const value = values[b.key] ?? "";
              const filled = value.trim() !== "";
              const isFocused = focused?.key === b.key;
              const s = b.style ?? DEFAULT_BOX_STYLE;
              const boxHeight = Math.max(b.height * fitted.height, 5);
              const isTick = f?.uiType === "checkbox";
              const boxWidth = Math.max(b.width * fitted.width, 5);
              const fontSize = s.fontSizeFrac
                ? Math.max(s.fontSizeFrac * fitted.height, 3)
                : autoFontSize(isTick ? "✔" : value, boxWidth, boxHeight, isTick);
              return (
                <button
                  key={b.key}
                  type="button"
                  aria-label={f?.label ?? b.key}
                  onClick={() => focusBox(b.key)}
                  onMouseDown={isFocusMode ? keepKeyboard : undefined}
                  className={cn(
                    "absolute box-border flex items-center overflow-hidden rounded-[1px] border",
                    isFocused ? "z-20 border-[2px] border-primary" : "z-0"
                  )}
                  style={{
                    left: b.x * fitted.width,
                    top: b.y * fitted.height,
                    width: boxWidth,
                    height: boxHeight,
                    // Pale blue is the field highlight every PDF reader draws. The box being filled
                    // right now takes the app's action colour instead, plus a halo outside it.
                    background: isFocused ? FOCUS_TINT : FIELD_TINT,
                    borderColor: isFocused ? undefined : FIELD_TINT_BORDER,
                    boxShadow: isFocused ? FOCUS_HALO : undefined,
                    justifyContent:
                      isTick || s.alignment === "center"
                        ? "center"
                        : s.alignment === "right"
                          ? "flex-end"
                          : "flex-start",
                  }}
                >
                  {filled ? (
                    <span
                      className="pointer-events-none block max-w-full overflow-hidden whitespace-nowrap px-[1px] leading-none"
                      style={{
                        fontSize,
                        fontFamily: isTick ? undefined : s.fontFamily,
                        fontStyle: s.italic && !isTick ? "italic" : undefined,
                        fontWeight: s.bold && !isTick ? 700 : undefined,
                        color: s.color,
                      }}
                    >
                      {isTick ? s.checkMark ?? "✔" : value}
                    </span>
                  ) : null}
                </button>
              );
            })
          : null}
      </div>

      {!isFocusMode ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#E8E4DC] to-transparent p-2.5 text-center">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#6E675C]">
            Tap a box · pinch to zoom
          </span>
        </div>
      ) : null}
    </div>
  );

  const progress = (
    <div className="flex shrink-0 items-center gap-3 px-1">
      <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-border">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${order.length ? (filledCount / order.length) * 100 : 0}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {filledCount} / {order.length}
      </span>
      {pageCount > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onMouseDown={keepKeyboard}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="tap-active grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary text-muted-foreground disabled:opacity-40"
          >
            ‹
          </button>
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            p{page}/{pageCount}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= pageCount}
            onMouseDown={keepKeyboard}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="tap-active grid h-7 w-7 place-items-center rounded-md border border-border bg-secondary text-muted-foreground disabled:opacity-40"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );

  const dock = focused ? (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-secondary px-3 pb-3 pt-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] font-semibold",
            focused.unnamed && "font-medium text-muted-foreground"
          )}
        >
          {focused.label}
        </span>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
          {focusIndex! + 1} / {order.length}
        </span>
      </div>

      {focused.options?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {focused.options.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={keepKeyboard}
              onClick={() => setValue(focused.key, values[focused.key] === o ? "" : o)}
              className={cn(
                "tap-active rounded-full border px-3 py-1.5 text-[13.5px]",
                values[focused.key] === o
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              {o}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Previous box"
          onMouseDown={keepKeyboard}
          onClick={() => step(-1)}
          disabled={focusIndex === 0}
          className="tap-active grid w-11 place-items-center rounded-md border border-border bg-muted text-lg text-muted-foreground disabled:opacity-40"
        >
          ‹
        </button>

        {/*
          ONE input, always here, never unmounted while a box is focused.
          On a tick box or a choice row it is still the focused element — invisible behind the
          control that is actually on offer — because blurring it would close the keyboard and
          resize the screen, which is the exact stutter this replaced.
        */}
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={typesValues ? values[focused.key] ?? "" : ""}
            onChange={(e) => {
              if (typesValues) setValue(focused.key, e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                step(1);
              }
            }}
            enterKeyHint="next"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="—"
            aria-label={focused.label}
            aria-hidden={!typesValues}
            tabIndex={typesValues ? undefined : -1}
            className={cn(
              "w-full rounded-md border border-primary bg-background px-3 py-2.5 text-[17px] outline-none ring-[3px] ring-primary/10",
              !typesValues && "pointer-events-none opacity-0"
            )}
          />

          {!typesValues ? (
            <button
              type="button"
              onMouseDown={keepKeyboard}
              onClick={() =>
                focused.uiType === "checkbox"
                  ? setValue(focused.key, values[focused.key] ? "" : "1")
                  : undefined
              }
              disabled={focused.uiType !== "checkbox"}
              className={cn(
                "absolute inset-0 rounded-md border px-3 text-[15px] font-semibold",
                values[focused.key]
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground"
              )}
            >
              {focused.uiType === "checkbox"
                ? values[focused.key]
                  ? "Ticked"
                  : "Not ticked"
                : values[focused.key] || "Pick one"}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Next box"
          onMouseDown={keepKeyboard}
          onClick={() => step(1)}
          disabled={focusIndex === order.length - 1}
          className="tap-active grid w-11 place-items-center rounded-md bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-40"
        >
          ›
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
          {focused.sectionTitle}
        </span>
        <button
          type="button"
          onClick={exitFocus}
          className="shrink-0 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          Done
        </button>
      </div>
    </div>
  ) : null;

  /*
   * Focused, this takes the whole screen and is sized from `visualViewport`.
   *
   * That is what stops the keyboard shoving the page around: the browser has nothing to scroll,
   * and when the keyboard opens the visual viewport shrinks, so the sheet gets shorter while the
   * bar stays exactly where it was.
   */
  if (isFocusMode && typeof document !== "undefined") {
    /*
     * Sent to the document root rather than rendered in place.
     *
     * The app shell puts this component inside an element that creates its own stacking context, so
     * a `z-50` piece of app chrome kept painting over the value bar no matter how high this went —
     * a z-index only competes with its siblings. At the root it competes with the chrome directly.
     */
    return createPortal(
      <div
        className="fixed inset-x-0 top-0 z-[60] flex flex-col bg-background"
        style={{ height: visualHeight ? `${visualHeight}px` : "100dvh" }}
      >
        <div className="shrink-0 px-3 pb-1.5 pt-2">{progress}</div>
        {sheet}
        {dock}
      </div>,
      document.body
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {progress}
      {/*
        As tall as the page is, up to most of the screen. A landscape sheet — Mugen's is wider than
        it is tall — otherwise sat at the top of a fixed-height stage with dead space beneath it.
      */}
      <div
        className="flex flex-col"
        style={{ height: fitted.height ? `${Math.round(fitted.height)}px` : "62vh", maxHeight: "62vh" }}
      >
        {sheet}
      </div>
    </div>
  );
}
