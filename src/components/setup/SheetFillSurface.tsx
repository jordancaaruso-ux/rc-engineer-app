"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import {
  optionSelectedInSurfaceValue,
  toggleOptionInSurfaceValue,
} from "@/lib/setupSheetModels/sheetSurfaceValues";
import { ZAPF_MARKS, type ZapfMarkPlacement } from "@/lib/setupDocuments/zapfDingbatMarks";

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
  /**
   * Tick boxes: the sheet's own placement of that mark. When it is here the mark is drawn as the
   * real ZapfDingbats outline, at the size and position the PDF states — see `SheetMark`. When it
   * is not, `checkMark` is printed as a character and centred, which is the older, looser drawing.
   */
  markPlacement?: ZapfMarkPlacement;
  /** The PDF marks this box as multiline — it wraps rather than shrinking. See `autoFontSize`. */
  multiline?: boolean;
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
  /**
   * Set when this box is one printed CHOICE of a grouped parameter — several boxes then share one
   * `key`. The box shows its mark when the parameter's value matches this option, and tapping it
   * picks the option directly, exactly like ticking the paper.
   */
  optionValue?: string;
};

export type SheetFillField = {
  key: string;
  label: string;
  /** True when the label is a position, not a name — nobody has said what this box is yet. */
  unnamed: boolean;
  uiType: "text" | "checkbox";
  sectionTitle: string;
  options?: string[];
  /** Stored value for each entry of `options`, index-aligned. Falls back to the labels. */
  optionValues?: string[];
  /** Many-of-many: the value holds every ticked option, not one. */
  multi?: boolean;
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

/**
 * How much of the window the sheet may take on a desktop.
 *
 * Fitting the page to its column's WIDTH put the bottom of the sheet below the fold, and the value
 * bar below that again — so clicking a box moved keyboard focus somewhere off screen and the browser
 * scrolled the window down to reach it. Nothing asked for that scroll; it is what browsers do.
 *
 * Fitted to the window there is nothing below to scroll to. The page comes out smaller, and the
 * driver zooms in with the wheel — which is the flow anyway, and their zoom, not ours.
 */
const DESKTOP_MAX_STAGE_VH = 78;
/** Below this a drag is a tap, not a pan — thumbs are not steady on a pit table. */
const TAP_SLOP_PX = 8;

/**
 * How far one notch of the wheel moves the zoom.
 *
 * A mouse wheel reports about 100 per notch, so this is roughly 15% a notch — the step a map or an
 * image viewer uses. A trackpad pinch arrives as a wheel event with `ctrlKey` set and a much smaller
 * delta per event, many events a second, so it gets its own rate and comes out feeling continuous.
 */
const WHEEL_ZOOM_RATE = 0.0015;
const PINCH_WHEEL_ZOOM_RATE = 0.01;

/** Wheel deltas come in pixels, lines or pages depending on the browser. Get them all to pixels. */
function wheelPixels(e: WheelEvent): number {
  if (e.deltaMode === 1) return e.deltaY * 33;
  if (e.deltaMode === 2) return e.deltaY * 400;
  return e.deltaY;
}

/**
 * True on a machine with a mouse — which here means "not the phone this surface was designed for".
 *
 * The phone behaviour and the desktop behaviour genuinely differ, and not because of screen width.
 * A phone has a keyboard that covers half the screen and fingers that cannot hit a six-pixel box;
 * a desktop has neither problem and a sheet that fits on screen whole. So the auto-zoom, the
 * fullscreen takeover and the word "pinch" are all phone answers, and asking about the pointer is
 * how this tells which machine it is on. Starts false so the server and the first paint agree.
 */
function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => setFine(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return fine;
}

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
const FOCUS_HALO = "0 0 0 1px rgba(255, 214, 10, 0.95), 0 0 0 3px rgba(255, 214, 10, 0.16)";

/**
 * A viewer sizes an auto-sized value to the box; this is that, near enough to read the same.
 *
 * MEASURED, NOT CHOSEN (2026-08-14). A real filled A800RR sheet carries a baked appearance stream
 * per box stating the size the viewer committed to. Across its 77 auto-sized filled boxes, the size
 * the viewer picked came to a median **0.723** of the box height — 0.734 across the 73 whose height
 * was the binding limit. The app's previous 0.66 drew every value about 1.1pt small, which is what
 * "the text looks slightly different" was.
 */
const AUTO_TEXT_HEIGHT_RATIO = 0.73;
const AUTO_MARK_HEIGHT_RATIO = 0.78;

/**
 * A note box is not sized to its height — it wraps.
 *
 * The same sheet's comments box is 78.6pt tall and its viewer drew 11pt in it, a ratio of 0.14: a
 * multiline field gets a comfortable reading size and as many lines as it needs, not one enormous
 * line. Applying the height ratio there produced text five times too big, and capping it by width on
 * one imaginary line produced text half the size it should be, which is what actually shipped.
 *
 * So a multiline box is capped at a share of the PAGE height rather than its own — 11pt on this
 * sheet's 842pt page is 0.0131, and the cap sits just above it. Fitted to one real sample, which is
 * one more than the old number had; Acrobat's multiline rule is not published.
 */
const AUTO_MULTILINE_MAX_PAGE_FRAC = 0.0143;
/** Line box as a share of font size — ordinary text leading, used when wrapping. */
const AUTO_LINE_HEIGHT = 1.15;

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

/**
 * Roughly how wide a character is, as a share of its size, in the fonts these sheets use.
 *
 * Measured the same way as {@link AUTO_TEXT_HEIGHT_RATIO}: on the four filled boxes whose WIDTH was
 * the binding limit, the advance implied by the size the viewer chose came to a median 0.536.
 */
const AVERAGE_ADVANCE = 0.54;

/**
 * The size a viewer picks when the field says `0 Tf` — big enough to read, small enough to fit.
 *
 * Sizing by the box's height alone is not enough: setup-sheet boxes are short and narrow, so "0.5"
 * at nearly the full box height overflows a bump-steer box and gets cut off. A viewer shrinks the
 * text until the whole value fits, and so does this.
 *
 * A multiline box is the other way round — it wraps instead of shrinking, so the width limit is
 * shared across however many lines fit, and the whole thing is capped at a readable size rather than
 * grown to the box. See {@link AUTO_MULTILINE_MAX_PAGE_FRAC}.
 */
function autoFontSize(input: {
  text: string;
  boxWidth: number;
  boxHeight: number;
  isTick: boolean;
  multiline?: boolean;
  /** Rendered height of the whole page, for the multiline cap. Omitted disables it. */
  pageHeight?: number;
}): number {
  const { text, boxWidth, boxHeight, isTick } = input;
  const byHeight = boxHeight * (isTick ? AUTO_MARK_HEIGHT_RATIO : AUTO_TEXT_HEIGHT_RATIO);
  const chars = Math.max(text.length, 1);
  const inner = Math.max(boxWidth - 2, 1);

  if (!input.multiline || isTick) {
    return Math.max(Math.min(byHeight, inner / (chars * AVERAGE_ADVANCE)), 3);
  }

  const cap = input.pageHeight ? input.pageHeight * AUTO_MULTILINE_MAX_PAGE_FRAC : byHeight;
  // Largest size at which the wrapped text still fits the box's height. Solved by walking down from
  // the cap rather than in closed form, because the line count is a ceiling and the closed form
  // rounds the wrong way — it returned a size whose fourth line fell off the bottom of the box.
  let size = Math.min(cap, byHeight);
  while (size > 3) {
    const perLine = Math.max(Math.floor(inner / (size * AVERAGE_ADVANCE)), 1);
    if (Math.ceil(chars / perLine) * size * AUTO_LINE_HEIGHT <= boxHeight) break;
    size -= 0.5;
  }
  return Math.max(size, 3);
}

/**
 * A ticked box's mark, drawn the way the sheet draws it.
 *
 * ============================== WHY THIS IS NOT A CHARACTER ==============================
 *
 * The mark used to be printed as the nearest Unicode character — `✔` — in whatever font the page
 * was set in, sized to a share of the box and centred. Three things were wrong with that, and all
 * three are visible next to the same sheet open in Acrobat:
 *
 *  1. **The shape.** A browser has no ZapfDingbats, so `✔` came out of the UI font: a thinner,
 *     straighter check than the one the PDF names. The outlines in `zapfDingbatMarks` are the real
 *     glyphs, so this draws the sheet's own mark rather than a lookalike.
 *  2. **The size and position.** The sheet states both — the A800RR draws a 14pt mark in a 12.3pt
 *     box, deliberately overflowing — and centring a box-sized character states neither.
 *  3. **The clip.** That overflow is cut off by a window the sheet also states. Without it the
 *     A800RR's check has a corner it should not have, and its shock-position boxes, which draw a
 *     75pt glyph through a 4.8pt-wide slot, print as a small square instead of the tall red bar the
 *     driver is used to.
 *
 * The whole thing is one `<svg>` in the box's own point space, stretched to the box with
 * `preserveAspectRatio="none"` exactly as a viewer maps an appearance box onto a widget rectangle.
 * PDF space has y going UP, so the group flips it; that is the only conversion in here.
 */
function SheetMark({
  placement,
  color,
  borderWidth,
}: {
  placement: ZapfMarkPlacement;
  color: string;
  /**
   * The box's own border, in CSS pixels. A box being filled draws one to say it is a box; the
   * widget rectangle is the BORDER box, so the mark is pulled out over it — otherwise every mark
   * is squeezed by two pixels that have nothing to do with the sheet.
   */
  borderWidth: number;
}) {
  const clip = placement.clip;
  // Unique per mark on the page: two `clipPath`s sharing an id would silently clip to the first,
  // and a sheet draws a hundred of these.
  const clipId = useId();

  /*
   * Two kinds of mark, one drawing.
   *
   * A sheet that spells its tick as a ZapfDingbats character gives a size and a baseline, so the
   * traced outline is scaled from its 1000-unit em and moved there. A sheet that draws its own
   * curves has already said everything, in the box's own points, so it is drawn as it is. Either
   * way the result is in PDF space, and the flip below is the only conversion.
   */
  const path =
    placement.kind === "glyph"
      ? {
          d: ZAPF_MARKS[placement.glyph].d,
          transform: `translate(${placement.x} ${placement.boxHeight - placement.y}) scale(${placement.size / 1000} ${-placement.size / 1000})`,
        }
      : {
          d: placement.d,
          transform: `translate(0 ${placement.boxHeight}) scale(1 -1)`,
        };

  return (
    <svg
      className="pointer-events-none absolute block"
      style={{ inset: -borderWidth }}
      viewBox={`0 0 ${placement.boxWidth} ${placement.boxHeight}`}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      {clip ? (
        <clipPath id={clipId}>
          <rect
            x={clip[0]}
            y={placement.boxHeight - (clip[1] + clip[3])}
            width={clip[2]}
            height={clip[3]}
          />
        </clipPath>
      ) : null}
      <g clipPath={clip ? `url(#${clipId})` : undefined}>
        <path d={path.d} fill={color} transform={path.transform} />
      </g>
    </svg>
  );
}

/** Structural, so it takes both React's synthetic touches and the DOM's. */
function distance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function SheetFillSurface({
  pageImageUrl,
  planUrl,
  initialValues,
  alternateValues,
  showAlternate = false,
  onChange,
  storageKey,
  readOnly = false,
  onPlanLoaded,
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
  /**
   * The other setup in a comparison, in the same surface shape as `initialValues`.
   *
   * A second value set rather than a second surface, because a comparison here is answered by
   * FLIPPING: the same page picture, the same boxes, the same fonts, and only the strings inside
   * the boxes different. That is what makes the changed values the only thing on the page that
   * moves when you flip — nothing has to be drawn on the paper to point them out.
   *
   * It cannot be done by swapping `initialValues`: that seeds state once (see below), so the sheet
   * would never re-read it. Remounting with a `key` would re-read it and reset zoom, pan and page
   * — and a view that shifts by one pixel between the two sides makes every box look like it moved,
   * which is exactly the signal being read.
   */
  alternateValues?: Record<string, string> | null;
  /** Draw `alternateValues` instead of `values`. Read-only only — see the guard below. */
  showAlternate?: boolean;
  onChange?: (values: Record<string, string>) => void;
  /** When set, values survive a reload — a sheet is filled over a whole day, not in one sitting. */
  storageKey?: string;
  /**
   * Show a saved setup on its sheet: values draw, boxes don't tint as fillable, nothing edits.
   * Zoom and pan stay — reading a sheet on a phone needs them as much as filling one does.
   */
  readOnly?: boolean;
  /** The plan, once it arrives — callers convert values against it (see sheetSurfaceValues). */
  onPlanLoaded?: (plan: SheetFillPlan) => void;
}) {
  const finePointer = useFinePointer();

  const [plan, setPlan] = useState<SheetFillPlan>(EMPTY_PLAN);
  const [planError, setPlanError] = useState<string | null>(null);
  const { fields, boxes, pageCount } = plan;

  /** The page picture: still coming, here, or refused. Blank paper alone tells the driver nothing. */
  const [pageImage, setPageImage] = useState<"loading" | "ready" | "failed">("loading");

  const [values, setValues] = useState<Record<string, string>>(initialValues ?? {});

  /**
   * Which value set the boxes draw from.
   *
   * A sheet BEING FILLED draws from its own state, seeded once — see `initialValues`. Re-reading
   * the prop there would rewrite boxes under the driver's fingers.
   *
   * A sheet BEING READ draws straight from the prop, because it has no state worth protecting:
   * nothing here can edit it (`focusBox` refuses, and no input is ever mounted), so `values` can
   * only ever hold whatever it was seeded with.
   *
   * That difference is the whole bug this fixes (founder, 2026-08-15: "the setup sheet shows but
   * it's blank"). A caller that fetches the values — the session view's Setup modal — mounts this
   * the moment it learns the CAR draws as a sheet, which is a different request and often the
   * faster one. Seeding once then meant the sheet kept the empty object it was born with and
   * ignored the setup when it landed: the driver's own paper, correctly drawn, every box empty,
   * and no error anywhere to say so. Measured on a seeded A800RR run: 0 of 279 boxes drawn.
   *
   * Guarded on `readOnly` in both directions: an editable sheet must never print another setup's
   * values, or the next keystroke saves them onto this one.
   */
  const drawnValues = readOnly
    ? (showAlternate && alternateValues ? alternateValues : initialValues ?? values)
    : values;
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  /** The page's shape, learned when its picture loads: height as a multiple of width. */
  const [pageRatio, setPageRatio] = useState(0);
  /** What the driver is looking at: zoom, and where the page's top-left sits on the stage. */
  const [view, setView] = useState({ zoom: FIT_ZOOM, x: 0, y: 0 });
  const [animate, setAnimate] = useState(true);
  /** Desktop only: the box the pointer is over, so its name can be shown. */
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const [stage, setStage] = useState({ width: 0, height: 0 });
  const stageElRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /**
   * The page as drawn, in CSS pixels.
   *
   * A phone fills the width and lets the document scroll. A desktop fits the page INSIDE the stage —
   * width AND height — so the whole sheet is on screen at once and nothing sits below the fold.
   */
  const fitted = useMemo(() => {
    if (!pageRatio || !stage.width) return { width: 0, height: 0 };
    const width =
      finePointer && stage.height ? Math.min(stage.width, stage.height / pageRatio) : stage.width;
    return { width, height: width * pageRatio };
  }, [pageRatio, stage.width, stage.height, finePointer]);

  /**
   * How tall the stage itself is told to be.
   *
   * Measured from the WIDTH only, deliberately: `fitted` reads the stage's height back, so sizing
   * the stage from `fitted` would be a loop with no fixed point. Width does not depend on height.
   */
  const fitToWidthHeight = pageRatio && stage.width ? stage.width * pageRatio : 0;
  const stageHeightStyle = !fitToWidthHeight
    ? "62vh"
    : finePointer
      ? `min(${Math.round(fitToWidthHeight)}px, ${DESKTOP_MAX_STAGE_VH}vh)`
      : `${Math.round(fitToWidthHeight)}px`;

  /**
   * A grouped parameter prints as several boxes sharing one key, so "the" box for a key — where
   * focus pans to, where the hover name sits — is its first. Iterating in reverse makes the first
   * occurrence the one that survives the Map.
   */
  const boxByKey = useMemo(() => {
    const m = new Map<string, SheetFillBox>();
    for (let i = boxes.length - 1; i >= 0; i--) m.set(boxes[i]!.key, boxes[i]!);
    return m;
  }, [boxes]);
  /** Reading order is the order the fields arrive in — the derivation already sorted them. */
  const order = useMemo(() => fields.filter((f) => boxByKey.has(f.key)), [fields, boxByKey]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  const focused = focusIndex === null ? null : order[focusIndex] ?? null;
  const focusedBox = focused ? boxByKey.get(focused.key) ?? null : null;
  const isFocusMode = focusIndex !== null;
  /**
   * Taking over the whole screen is a PHONE answer to a phone problem: the keyboard covers half the
   * screen, so the sheet has to be sized against `visualViewport` or everything slides. A desktop
   * has no such keyboard, and swallowing the whole window when a box is clicked is exactly the
   * lurch the driver asked to stop. There, the sheet stays put and the value bar docks under it.
   */
  const fullscreenFocus = isFocusMode && !finePointer;
  /** True when this box is typed into. A tick box and a choice row are tapped, not typed. */
  const typesValues = focused ? focused.uiType !== "checkbox" && !focused.options?.length : false;
  /**
   * Desktop: the caret goes in the box on the sheet, and there is no bar underneath at all.
   *
   * The bar answers two phone problems — a thumb cannot hit a six-pixel box, and the keyboard covers
   * half the screen. A desktop has neither, so the bar was only ever a second place to look for a
   * box you had just clicked, and it was below the page, which is what dragged the window down.
   */
  const desktopEditing = finePointer && isFocusMode && typesValues;
  /**
   * Desktop: something must hold the keyboard for as long as ANY box is focused, typed or not.
   *
   * Tabbing along a row lands on tick boxes, and without this there was nothing focused when it did
   * — so the next keystroke went nowhere and tab stopped working from that box on. The holder sits
   * over a tick box with no caret and no pointer events, so a click still reaches the box itself.
   */
  const desktopHoldsKeyboard = finePointer && isFocusMode;

  // --- the box list ----------------------------------------------------------------------
  /** Ref, so an inline callback prop can't re-trigger the fetch. */
  const onPlanLoadedRef = useRef(onPlanLoaded);
  useEffect(() => {
    onPlanLoadedRef.current = onPlanLoaded;
  });
  useEffect(() => {
    let cancelled = false;
    fetch(planUrl, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Sheet unavailable (${res.status})`);
        return (await res.json()) as SheetFillPlan;
      })
      .then((p) => {
        if (cancelled) return;
        const loaded = { fields: p.fields ?? [], boxes: p.boxes ?? [], pageCount: p.pageCount || 1 };
        setPlan(loaded);
        onPlanLoadedRef.current?.(loaded);
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
  /**
   * The wheel handler, held behind a ref so the listener can be attached once.
   *
   * It has to be a real DOM listener rather than React's `onWheel`, because React registers wheel
   * listeners as passive and a passive listener may not call `preventDefault` — without which the
   * browser scrolls the page while the sheet zooms.
   */
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  /**
   * Touch, held behind refs for that reason and one more.
   *
   * React registers `touchstart` and `touchmove` as passive as well, so a handler mounted the React
   * way cannot call `preventDefault` either. That cost nothing while the stage claimed every gesture
   * with `touch-action: none` — the browser was never going to scroll, so refusing its default was
   * a formality. It matters now the stage hands one-finger drags back to the page at fit zoom: a
   * pinch has to be able to take a gesture back OFF the browser, and only a non-passive listener can.
   */
  const touchStartRef = useRef<(e: TouchEvent) => void>(() => {});
  const touchMoveRef = useRef<(e: TouchEvent) => void>(() => {});
  const touchEndRef = useRef<() => void>(() => {});
  const detachStageRef = useRef<(() => void) | null>(null);
  const attachStage = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    detachStageRef.current?.();
    detachStageRef.current = null;
    stageElRef.current = el;
    if (!el) return;
    const onWheel = (e: WheelEvent) => wheelRef.current(e);
    const onTouchStart = (e: TouchEvent) => touchStartRef.current(e);
    const onTouchMove = (e: TouchEvent) => touchMoveRef.current(e);
    const onTouchEnd = () => touchEndRef.current();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    detachStageRef.current = () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      detachStageRef.current?.();
    },
    []
  );

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
    if (!fullscreenFocus || typeof document === "undefined") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreenFocus]);

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

  /**
   * Follow the focused box onto its own page, then bring it into view.
   *
   * The two machines want opposite things here.
   *
   * On a PHONE the box is about six pixels tall and the sheet does not fit on the screen, so picking
   * a box has to zoom in and pan to it or you cannot see what you are typing into.
   *
   * On a DESKTOP the whole sheet is already on screen and the pointer is precise. Zooming in when a
   * box is clicked throws away the view the driver set up for themselves, for no gain — they could
   * already see the box, they just clicked it. So the zoom is left exactly alone, and the sheet only
   * moves when the box is genuinely off screen, which can only happen after the driver zoomed in.
   */
  useEffect(() => {
    if (!focusedBox) return;
    if (focusedBox.pageNumber !== page) setPage(focusedBox.pageNumber);
    if (!fitted.width || !stage.width) return;
    setAnimate(true);
    setView((v) => {
      if (!finePointer) return viewCentredOn(focusedBox, Math.max(v.zoom, FOCUS_ZOOM));
      const left = v.x + focusedBox.x * fitted.width * v.zoom;
      const top = v.y + focusedBox.y * fitted.height * v.zoom;
      const right = left + focusedBox.width * fitted.width * v.zoom;
      const bottom = top + focusedBox.height * fitted.height * v.zoom;
      const onScreen = left >= 0 && top >= 0 && right <= stage.width && bottom <= stage.height;
      return onScreen ? v : viewCentredOn(focusedBox, v.zoom);
    });
    // The current zoom is read inside the updater, never as a dependency — depending on it would
    // re-run this on every pinch and fight the driver for control of the zoom.
  }, [focusedBox, fitted.width, fitted.height, stage.width, stage.height, page, viewCentredOn, finePointer]);

  /**
   * The whole page is on screen: there is nothing left to pan to and nothing left to zoom out to.
   *
   * On a phone the stage is sized to be exactly as tall as the fitted page, so this is not "nearly
   * nothing left to do" — `clampView` centres the page and throws every drag away. It is the state
   * the sheet sits in until the driver zooms in, which is most of the time, and it is what decides
   * whether a drag or a wheel belongs to the sheet or to the page it is sitting in.
   */
  const atFitZoom = view.zoom <= FIT_ZOOM + 0.001;

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

  /**
   * Wheel and trackpad zoom, the way every map and image viewer does it: a modest step per notch,
   * anchored so whatever is under the pointer stays under the pointer.
   *
   * Bottoming out at `FIT_ZOOM` is deliberate. Zooming out past the fit would leave the sheet
   * floating in a grey field, and there is nothing out there to look at.
   */
  const zoomByWheel = useCallback(
    (e: WheelEvent) => {
      if (!fitted.width || !stage.width) return;
      /*
       * Fitted, the wheel goes back to the page.
       *
       * Zoomed in it is the only way to move towards or away from a box, so it stays ours. Fitted,
       * there is nothing to zoom out to, and swallowing it anyway means a sheet most of a screen
       * tall that the page cannot be scrolled past — put the pointer on the paper and the document
       * simply stops. Holding ctrl (or ⌘, and a trackpad pinch, which arrives as exactly that) still
       * zooms in from here, so no way in is lost.
       */
      const zoomIntent = e.ctrlKey || e.metaKey;
      if (atFitZoom && !zoomIntent) return;
      // Otherwise: always, so the page behind never scrolls out from under a driver aiming at a box.
      e.preventDefault();
      const rate = e.ctrlKey ? PINCH_WHEEL_ZOOM_RATE : WHEEL_ZOOM_RATE;
      const factor = Math.exp(-wheelPixels(e) * rate);
      const point = stagePoint(e.clientX, e.clientY);
      setAnimate(false);
      setView((v) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(FIT_ZOOM, v.zoom * factor));
        if (zoom === v.zoom) return v;
        const pageX = (point.x - v.x) / v.zoom;
        const pageY = (point.y - v.y) / v.zoom;
        return clampView({ zoom, x: point.x - pageX * zoom, y: point.y - pageY * zoom });
      });
    },
    [fitted.width, stage.width, stagePoint, clampView, atFitZoom]
  );
  useEffect(() => {
    wheelRef.current = zoomByWheel;
  }, [zoomByWheel]);

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      setAnimate(false);
      if (e.touches.length === 2) {
        /*
         * Take the gesture back off the browser.
         *
         * At fit zoom the stage says `touch-action: pan-y`, so the browser is allowed to scroll the
         * page with this gesture — and the moment it starts, every later `preventDefault` is ignored
         * and the pinch would zoom the sheet while the page slid out from under it. Refusing the
         * default here, on the touch-start that puts the second finger down, is the last point it
         * can be stopped.
         */
        if (e.cancelable) e.preventDefault();
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
      /*
       * One finger at fit zoom belongs to the page, not to the sheet.
       *
       * There is nothing to pan to, so `clampView` threw the movement away and the finger did
       * nothing at all — and because the stage is as tall as the page, that dead zone was most of
       * the phone screen. Arming no gesture leaves `touch-action: pan-y` to scroll whatever the
       * sheet sits in. Two fingers still reach the branch above, so pinching in from here works.
       *
       * It fixes a second thing for free: the browser cancels the click at the end of a scroll, so
       * a flick that lifts off over a box no longer opens that box. Our own pan could not tell the
       * difference, because `onTouchEnd` clears the gesture before the click that reads `moved`.
       */
      if (atFitZoom) {
        gesture.current = null;
        return;
      }
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
    [view, stagePoint, atFitZoom]
  );

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
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
        if (e.cancelable) e.preventDefault();
        return;
      }

      if (g.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0]!;
        const dx = t.clientX - g.startX;
        const dy = t.clientY - g.startY;
        g.moved = Math.max(g.moved, Math.hypot(dx, dy));
        if (g.moved < TAP_SLOP_PX) return; // still might be a tap on a box
        setView(clampView({ zoom: g.startView.zoom, x: g.startView.x + dx, y: g.startView.y + dy }));
        if (e.cancelable) e.preventDefault();
      }
    },
    [clampView]
  );

  const onTouchEnd = useCallback(() => {
    gesture.current = null;
  }, []);

  useEffect(() => {
    touchStartRef.current = onTouchStart;
    touchMoveRef.current = onTouchMove;
    touchEndRef.current = onTouchEnd;
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  /**
   * Dragging the sheet with the mouse.
   *
   * Zoomed in, the wheel is the only other way to move, and it only moves towards or away from
   * whatever the pointer is on. Without a drag, "zoom in on the corner you are filling" is a trap:
   * getting to the far corner means zooming out and back in again.
   *
   * The same slop rule as a thumb decides drag from click, so a drag that happens to end on a box
   * does not open it — `focusBox` reads `moved` and refuses. The ref is cleared a tick later so the
   * click event that follows the mouse-up can still see it.
   */
  const onStageMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!finePointer || e.button !== 0) return;
      // Not over the input being typed in: that click belongs to the caret.
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      // Otherwise the drag selects the page picture and the box labels instead of panning.
      e.preventDefault();
      setAnimate(false);
      gesture.current = {
        mode: "pan",
        startX: e.clientX,
        startY: e.clientY,
        startView: view,
        startDistance: 0,
        midX: 0,
        midY: 0,
        moved: 0,
      };
      const onMove = (ev: MouseEvent) => {
        const g = gesture.current;
        if (!g) return;
        const dx = ev.clientX - g.startX;
        const dy = ev.clientY - g.startY;
        g.moved = Math.max(g.moved, Math.hypot(dx, dy));
        if (g.moved < TAP_SLOP_PX) return;
        setView(clampView({ zoom: g.startView.zoom, x: g.startView.x + dx, y: g.startView.y + dy }));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        window.setTimeout(() => {
          gesture.current = null;
        }, 0);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [finePointer, view, clampView]
  );

  /**
   * Focusing anything inside an `overflow: hidden` box makes the browser scroll that box to reveal
   * it — and the page layer extends well outside the stage when zoomed, so it would shove the sheet
   * sideways. The stage has no scrollbars to lose, so putting it straight back is free.
   */
  const onStageScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    e.currentTarget.scrollTop = 0;
    e.currentTarget.scrollLeft = 0;
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
   * Answering a box that is not typed into: a tick goes on and off, a row of choices steps along and
   * then back to none. Shared, because the mouse and the space bar must do the same thing.
   */
  const answerWithoutTyping = useCallback((field: SheetFillField) => {
    setValues((prev) => {
      const current = prev[field.key] ?? "";
      if (field.options?.length) {
        // Stored values when the plan declares them, labels otherwise (a derived sheet's labels
        // ARE its values). Stepping compares case-insensitively so a saved "c127s" still steps.
        const opts = field.optionValues?.length ? field.optionValues : field.options;
        const i = opts.findIndex((o) => o.trim().toLowerCase() === current.trim().toLowerCase());
        return { ...prev, [field.key]: opts[i + 1] ?? "" };
      }
      return { ...prev, [field.key]: current ? "" : "1" };
    });
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
    (key: string, optionValue?: string) => {
      if (readOnly) return;
      // A drag that ended on a box is a pan, not a tap.
      if ((gesture.current?.moved ?? 0) >= TAP_SLOP_PX) return;
      const i = order.findIndex((f) => f.key === key);
      if (i < 0) return;
      haptic("light");
      const field = order[i]!;
      /*
       * A printed choice box IS its answer, on any pointer.
       *
       * On a calibrated sheet each option of a one-of-many row is its own box on the paper, and
       * the tap that lands on one says which choice is meant — the same gesture as ticking the
       * paper. The mark goes on (or off) right there. On a desktop nothing stays focused, because
       * there is nothing to type; on a phone the box KEEPS focus for the same two reasons a lone
       * tick box does below — the one input must never blur or the keyboard closes and the screen
       * resizes mid-sheet, and the bar is the only confirmation a 7px square can give. Dropping it
       * here while the lone boxes beside it kept theirs was the "some checkboxes close the
       * keyboard" bug on the Mi10 sheet (founder, 2026-08-15).
       */
      if (optionValue !== undefined) {
        setValues((prev) => ({
          ...prev,
          [key]: toggleOptionInSurfaceValue(prev[key] ?? "", optionValue, Boolean(field.multi)),
        }));
        if (finePointer) setFocusIndex(null);
        else setFocusIndex(i);
        return;
      }
      /*
       * A lone tick box IS its answer too, on any pointer — but it STAYS FOCUSED on a phone.
       *
       * It used to take two taps there: one to focus, one to press "Ticked" in the bar, while the
       * printed choice boxes sitting right beside it ticked on the first (founder, 2026-08-14).
       * The mark now goes on with the tap and a second tap takes it off.
       *
       * Focus is deliberately kept rather than dropped the way an option box drops it. Two reasons,
       * and both only bite on a phone: the one input must never blur or the keyboard closes and the
       * screen resizes mid-sheet (`sheet-fill.spec.ts` guards exactly this), and the bar flipping to
       * "Ticked" is the only confirmation a 7px square can give that the tap landed at all. On a
       * desktop there is no bar to keep, and `focusBox`'s caller clears it below.
       */
      if (field.uiType === "checkbox") {
        answerWithoutTyping(field);
        if (finePointer) setFocusIndex(null);
        else setFocusIndex(i);
        return;
      }
      /*
       * A ROW of choices still steps on a desktop only.
       *
       * There is no value bar there to answer it in, and a mouse hits the box it means, so a click
       * walks to the next option and then back to none — the way any PDF reader behaves. On a phone
       * the bar is the better answer: its chips let a thumb pick the option it means outright,
       * instead of tapping a 7px square four times to walk round to it.
       */
      if (finePointer && field.options?.length) {
        answerWithoutTyping(field);
        setFocusIndex(null);
        return;
      }
      setFocusIndex(i);
    },
    [order, finePointer, answerWithoutTyping, readOnly]
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
    // Only the phone zoomed on the way in, so only the phone unzooms on the way out. Resetting a
    // zoom the driver set with their own wheel would be taking it off them for nothing.
    if (!finePointer) setView({ zoom: FIT_ZOOM, x: 0, y: 0 });
  }, [finePointer]);

  const pageBoxes = useMemo(() => boxes.filter((b) => b.pageNumber === page), [boxes, page]);

  /** Where the hovered box's name goes, in the stage's own unscaled pixels. Null = show nothing. */
  const hoverName = useMemo(() => {
    if (!finePointer || !hoverKey || !fitted.width) return null;
    /*
     * Nothing while a box is focused.
     *
     * The pointer sits wherever it last clicked, so the name popped up over the row above the box
     * being typed in — covering the value that had just been entered. The name is for finding your
     * way around the sheet, which is not what you are doing once you are filling one in.
     */
    if (isFocusMode) return null;
    const b = boxByKey.get(hoverKey);
    const f = fieldByKey.get(hoverKey);
    if (!b || !f || b.pageNumber !== page) return null;
    const left = view.x + (b.x + b.width / 2) * fitted.width * view.zoom;
    const top = view.y + b.y * fitted.height * view.zoom - 6;
    if (left < 0 || left > stage.width || top < 0 || top > stage.height) return null;
    return { label: f.label, left, top };
  }, [finePointer, hoverKey, fitted, view, boxByKey, fieldByKey, page, stage, isFocusMode]);

  // Turning to page 2 asks the server for a picture it has probably never drawn, so the wait — and
  // any refusal — belongs to that page, not to the one that already loaded.
  useEffect(() => {
    setPageImage("loading");
  }, [page]);

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
      /* Touch is wired by hand in `attachStage`: React's own touch props are passive. */
      onMouseDown={onStageMouseDown}
      onMouseLeave={finePointer ? () => setHoverKey(null) : undefined}
      onScroll={onStageScroll}
      // Clicking the paper itself leaves the box you were in. A drag that ends on paper does not.
      onClick={(e) => {
        if (!finePointer || !isFocusMode) return;
        if ((gesture.current?.moved ?? 0) >= TAP_SLOP_PX) return;
        if ((e.target as HTMLElement | null)?.closest("[data-sheet-box]")) return;
        if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
        exitFocus();
      }}
      className={cn(
        "relative flex-1 overflow-hidden bg-[#E8E4DC]",
        !fullscreenFocus && "rounded-lg border border-border"
      )}
      /*
       * `none` so two fingers reach this element instead of scrolling the page — the app disables
       * browser zoom globally, so pinching the sheet is handled here or not at all.
       *
       * `pan-y` once the page is fitted, which hands a one-finger drag back to whatever the sheet is
       * sitting in (`onTouchStart` disarms our pan to match). Pinch survives it because the two-finger
       * touch-start refuses the browser's default. Focus mode keeps `none` regardless: it owns the
       * screen and there is deliberately nothing behind it to scroll.
       */
      style={{
        touchAction: atFitZoom && !fullscreenFocus ? "pan-y" : "none",
        minHeight: 0,
      }}
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
            width={Math.round(fitted.width || stage.width)}
            onLoad={(e) => {
              const img = e.currentTarget;
              setPageImage("ready");
              if (img.naturalWidth > 0) setPageRatio(img.naturalHeight / img.naturalWidth);
            }}
            // Without this a refused page looks exactly like a page still being drawn: blank paper.
            onError={() => setPageImage("failed")}
            className="block select-none"
            style={{ width: fitted.width || stage.width, height: "auto" }}
            draggable={false}
          />
        ) : null}

        {fitted.width > 0
          ? pageBoxes.map((b, boxIndex) => {
              const f = fieldByKey.get(b.key);
              const value = drawnValues[b.key] ?? "";
              /*
               * An option box is one printed CHOICE of a grouped row: it draws its tick when the
               * row's value matches ITS option, never the value text itself.
               */
              const isOptionBox = b.optionValue !== undefined;
              // Say the option's LABEL, not its stored slug — "Damping · Front — Linear",
              // never "— linear". The slug is the value; the label is the words on the paper.
              const optionLabel = isOptionBox
                ? (f?.options?.[f.optionValues?.indexOf(b.optionValue!) ?? -1] ?? b.optionValue!)
                : null;
              const isTick = isOptionBox || f?.uiType === "checkbox";
              const filled = isOptionBox
                ? optionSelectedInSurfaceValue(value, b.optionValue!, Boolean(f?.multi))
                : value.trim() !== "";
              const isFocused = focused?.key === b.key;
              const s = b.style ?? DEFAULT_BOX_STYLE;
              const boxHeight = Math.max(b.height * fitted.height, 5);
              const boxWidth = Math.max(b.width * fitted.width, 5);
              const fontSize = s.fontSizeFrac
                ? Math.max(s.fontSizeFrac * fitted.height, 3)
                : autoFontSize({
                    text: isTick ? "✔" : value,
                    boxWidth,
                    boxHeight,
                    isTick,
                    multiline: s.multiline,
                    pageHeight: fitted.height,
                  });
              const editingHere = desktopEditing && isFocused;
              return (
                <button
                  // Option boxes share their parameter's key, so the key alone can't be React's.
                  key={`${b.key}#${b.optionValue ?? boxIndex}`}
                  type="button"
                  data-sheet-box=""
                  aria-label={
                    isOptionBox ? `${f?.label ?? b.key} — ${optionLabel}` : (f?.label ?? b.key)
                  }
                  aria-pressed={isOptionBox ? filled : undefined}
                  // Not `disabled` — the hover name should still say what a box is on a sheet
                  // that is only being read. focusBox itself refuses edits when read-only.
                  aria-disabled={readOnly || undefined}
                  onClick={readOnly ? undefined : () => focusBox(b.key, b.optionValue)}
                  // Only the phone has a keyboard to protect; on a desktop the stage wants the
                  // mousedown so a drag from anywhere on the sheet pans it.
                  onMouseDown={!finePointer && isFocusMode ? keepKeyboard : undefined}
                  onMouseEnter={finePointer ? () => setHoverKey(b.key) : undefined}
                  onMouseLeave={finePointer ? () => setHoverKey((k) => (k === b.key ? null : k)) : undefined}
                  className={cn(
                    "absolute box-border flex items-center overflow-hidden rounded-[1px]",
                    !readOnly && "border",
                    isFocused && !readOnly ? "z-20 border-primary-ink" : "z-0"
                  )}
                  style={{
                    left: b.x * fitted.width,
                    top: b.y * fitted.height,
                    width: boxWidth,
                    height: boxHeight,
                    /*
                     * Pale blue is the field highlight every PDF reader draws — an invitation to
                     * fill. A read-only sheet extends no invitation: the paper shows through bare
                     * and only the values sit on it, the way a printed, filled-in sheet looks.
                     */
                    background: readOnly ? "transparent" : isFocused ? FOCUS_TINT : FIELD_TINT,
                    borderColor: isFocused && !readOnly ? undefined : FIELD_TINT_BORDER,
                    boxShadow: isFocused && !readOnly ? FOCUS_HALO : undefined,
                    justifyContent:
                      isTick || s.alignment === "center"
                        ? "center"
                        : s.alignment === "right"
                          ? "flex-end"
                          : "flex-start",
                  }}
                >
                  {/* The box being typed into draws its own value, in the input sitting over it. */}
                  {filled && !editingHere ? (
                    isTick && s.markPlacement ? (
                      // The sheet's own mark, at the sheet's own size and position. See `SheetMark`.
                      <SheetMark
                        placement={s.markPlacement}
                        color={s.color}
                        borderWidth={readOnly ? 0 : isFocused ? 2 : 1}
                      />
                    ) : (
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
                    )
                  ) : null}
                </button>
              );
            })
          : null}

        {/*
          DESKTOP: the value is typed in the box, in the font it will print in.

          Inside the transformed layer on purpose, so the caret and the text scale with the sheet
          exactly as the printed value does — type at whatever zoom you chose and what you see is
          what the box will hold. The focus halo on the box underneath is what tells you where you
          are, since a caret a few pixels tall does not.
        */}
        {desktopHoldsKeyboard && focused && focusedBox && focusedBox.pageNumber === page && fitted.width > 0
          ? (() => {
              const s = focusedBox.style ?? DEFAULT_BOX_STYLE;
              const value = values[focused.key] ?? "";
              const boxWidth = Math.max(focusedBox.width * fitted.width, 5);
              const boxHeight = Math.max(focusedBox.height * fitted.height, 5);
              const fontSize = s.fontSizeFrac
                ? Math.max(s.fontSizeFrac * fitted.height, 3)
                : autoFontSize({
                    text: value,
                    boxWidth,
                    boxHeight,
                    isTick: false,
                    multiline: s.multiline,
                    pageHeight: fitted.height,
                  });
              return (
                <input
                  ref={inputRef}
                  // The wizard bottom bar hides while a text field has focus, but this input
                  // HOLDS focus for the whole editing session by design — the attribute tells
                  // the bar to stay put on fine-pointer devices (LogRunWizardBottomBar).
                  data-persistent-editor=""
                  value={typesValues ? value : ""}
                  readOnly={!typesValues}
                  onChange={(e) => {
                    if (typesValues) setValue(focused.key, e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      step(1);
                      return;
                    }
                    // Taken over, or the first Tab leaves the sheet entirely.
                    if (e.key === "Tab") {
                      e.preventDefault();
                      step(e.shiftKey ? -1 : 1);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      exitFocus();
                      return;
                    }
                    // A box you tabbed onto rather than clicked is answered with the space bar.
                    if (!typesValues && (e.key === " " || e.key === "Spacebar")) {
                      e.preventDefault();
                      answerWithoutTyping(focused);
                    }
                  }}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label={focused.label}
                  aria-hidden={!typesValues}
                  className="absolute z-30 block border-0 bg-transparent p-0 leading-none outline-none"
                  style={{
                    left: focusedBox.x * fitted.width,
                    top: focusedBox.y * fitted.height,
                    width: boxWidth,
                    height: boxHeight,
                    paddingInline: 1,
                    fontSize,
                    fontFamily: s.fontFamily,
                    fontStyle: s.italic ? "italic" : undefined,
                    fontWeight: s.bold ? 700 : undefined,
                    color: s.color,
                    // A tick box draws its own mark underneath, so the holder shows nothing at all
                    // and lets the click through to the box it is sitting on.
                    caretColor: typesValues ? s.color : "transparent",
                    textAlign: s.alignment,
                    pointerEvents: typesValues ? undefined : "none",
                  }}
                />
              );
            })()
          : null}
      </div>

      {/*
        The app knows what many of these boxes are called, and the sheet prints its own caption
        beside each one — so the name is offered on hover and never otherwise. Drawn OUTSIDE the
        transformed layer: inside it, it would scale with the page and be unreadable at the zoom
        where you actually want it.
      */}
      {finePointer && hoverName ? (
        <div
          className="pointer-events-none absolute z-40 max-w-[240px] -translate-x-1/2 -translate-y-full truncate rounded-md bg-foreground/90 px-2 py-1 text-[11px] font-medium text-background shadow-sm"
          style={{ left: hoverName.left, top: hoverName.top }}
        >
          {hoverName.label}
        </div>
      ) : null}

      {/*
        The first driver on a chassis waits while the server draws the page, and a sheet still being
        drawn used to look identical to one that had failed: pale, empty paper. Both now say which
        they are, over the paper rather than instead of it, so the boxes stay where they are.
      */}
      {pageImage !== "ready" ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          {pageImage === "loading" ? (
            <span className="flex items-center gap-2 text-[13px] text-[#6E675C]">
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
              Drawing your sheet…
            </span>
          ) : (
            <span className="max-w-xs text-[13px] leading-relaxed text-[#6E675C]">
              Couldn&apos;t draw this page of your sheet. Your boxes below still work, and reopening
              this setup tries again.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );

  const progress = (
    <div className="flex shrink-0 items-center gap-3 px-1">
      {/* A read-only sheet has no fill progress — only the pager, when there are pages to turn. */}
      {readOnly ? (
        <div className="flex-1" />
      ) : (
        <>
          <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-border">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: `${order.length ? (filledCount / order.length) * 100 : 0}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {filledCount} / {order.length}
          </span>
        </>
      )}
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
          <span className="text-[11px] tabular-nums text-muted-foreground">
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

  /*
   * The bar exists on the phone only.
   *
   * On a desktop the caret is in the box on the sheet, so a bar under the page would be a second
   * place to look at a box you had just clicked — and, sitting below the page, it is what pulled the
   * window down every time one was clicked.
   */
  const dock = focused && !finePointer ? (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-secondary px-3 pb-3 pt-2.5">
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[15px] font-semibold",
            focused.unnamed && "font-medium text-muted-foreground"
          )}
        >
          {focused.label}
        </span>
        {/*
          Done is the way OUT of the sheet's one modal state, so it sits top-right of the bar with a
          border and a thumb-sized target (founder, 2026-08-14). It used to be muted 12px text in the
          bottom-right corner — 34×19px, right where the iPhone home indicator lives, reading as a
          caption beside the yellow ‹ › keys rather than as the button it is. The box counter took
          its old place on the bottom row, where it belongs with the section name.
        */}
        <button
          type="button"
          onMouseDown={keepKeyboard}
          onClick={exitFocus}
          className="tap-active -my-2 grid min-h-[44px] shrink-0 place-items-center rounded-md border border-border bg-card px-4 text-[13px] font-medium text-foreground"
        >
          Done
        </button>
      </div>

      {focused.options?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {focused.options.map((o, i) => {
            // The chip SHOWS the label and SETS the stored value — on a calibrated sheet they can
            // differ ("A" is stored as "a"). A many-of-many chip toggles membership, not the lot.
            const optionValue = focused.optionValues?.[i] ?? o;
            const on = optionSelectedInSurfaceValue(
              values[focused.key] ?? "",
              optionValue,
              Boolean(focused.multi)
            );
            return (
              <button
                key={o}
                type="button"
                onMouseDown={keepKeyboard}
                onClick={() =>
                  setValue(
                    focused.key,
                    toggleOptionInSurfaceValue(
                      values[focused.key] ?? "",
                      optionValue,
                      Boolean(focused.multi)
                    )
                  )
                }
                className={cn(
                  "tap-active rounded-full border px-3 py-1.5 text-[13.5px]",
                  on
                    ? "border-primary-ink bg-primary/10 text-primary-ink"
                    : "border-border bg-muted text-muted-foreground"
                )}
              >
                {o}
              </button>
            );
          })}
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
            // Same contract as the over-the-box render above: keep the wizard bar on
            // fine-pointer devices while this deliberately-never-blurred input has focus.
            data-persistent-editor=""
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
              "w-full rounded-md border border-primary-ink bg-background px-3 py-2.5 text-[17px] outline-none ring-[3px] ring-primary-ink/10",
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
                  ? "border-primary-ink bg-primary/10 text-primary-ink"
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
        <span className="min-w-0 truncate micro-caps text-faint">
          {focused.sectionTitle}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {focusIndex! + 1} / {order.length}
        </span>
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
  if (fullscreenFocus && typeof document !== "undefined") {
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
      {readOnly && pageCount <= 1 ? null : progress}
      {/*
        EXACTLY as tall as the page, so the whole sheet is on screen.
        There used to be a `maxHeight: 62vh` on top of this, which cut the bottom off every sheet
        taller than that — on a desktop, most of the last third of an A4 page. Cropping the one
        thing this screen exists to show is worse than being tall: the page scrolls, the sheet
        doesn't have to.
      */}
      <div className="flex flex-col" style={{ height: stageHeightStyle }}>
        {sheet}
      </div>
      {dock}
      {/*
        Under the sheet, not over it. As an overlay across the bottom this covered the last inch of
        every page — the comments box on an X4, which is a real box a driver fills.
      */}
      {/* Desktop keeps this while focused: with no bar, it is the only thing telling you about tab. */}
      {!isFocusMode || finePointer ? (
        <p className="text-center micro-caps text-muted-foreground">
          {/* Fitted, the wheel scrolls the page and there is nothing to drag — so say the way in. */}
          {readOnly
            ? finePointer
              ? atFitZoom
                ? "Ctrl-scroll to zoom"
                : "Scroll to zoom · drag to move"
              : "Pinch to zoom"
            : finePointer
              ? atFitZoom
                ? "Click a box and type · ctrl-scroll to zoom · tab for the next box"
                : "Click a box and type · scroll to zoom · drag to move · tab for the next box"
              : "Tap a box · pinch to zoom"}
        </p>
      ) : null}
    </div>
  );
}
