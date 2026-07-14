"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Keeps a portal-rendered menu pinned directly *under* its anchor. Fixed
 * positioning + a capture-phase scroll listener so the menu escapes any
 * `overflow`/`backdrop-blur` stacking or clip context of ancestor cards.
 *
 * This matters most on mobile: a card with Tailwind's `overflow-x-auto`
 * (horizontal scroller) also computes `overflow-y: auto`, which turns the card
 * into a clip box. A plain `absolute` menu is then trapped inside it — it gets
 * clipped, appears to open upward when the trigger sits low, and drifts as the
 * card/page scrolls. Fixed + body-portal sidesteps all of that: the menu always
 * expands downward from the trigger's bottom edge and stays glued on scroll.
 */
export function useAnchoredMenuPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  gap = 4
): { top: number; left: number; width: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = anchorRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + gap, left: r.left, width: r.width });
    };
    update();
    // Capture phase so scrolls in *any* ancestor container keep the menu anchored.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    // iOS: opening the keyboard pans/resizes the *visual* viewport without always
    // firing window scroll events — track it so the menu re-pins under the input.
    const vv = typeof window.visualViewport !== "undefined" ? window.visualViewport : null;
    vv?.addEventListener("scroll", update);
    vv?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      vv?.removeEventListener("resize", update);
    };
  }, [open, anchorRef, gap]);
  return pos;
}

/**
 * Shared shell for every dropdown/menu so they all read as one system and share
 * the same anchoring behavior. Renders `children` (the caller's own `<ul>` /
 * menu content, keeping its `role`, borders, `max-h`, `overflow`, etc.) into a
 * `<body>` portal, positioned `fixed` directly beneath `anchorRef`.
 *
 * - Always expands downward from the trigger; stays glued to it on scroll/resize.
 * - `matchAnchorWidth` (default) sizes the menu to the trigger; a child with a
 *   larger `min-w-*` still grows rightward from the trigger's left edge.
 * - Pass `onClose` to opt into centralized outside-click + Escape dismissal
 *   (the anchor and the menu itself are excluded).
 */
export function AnchoredMenu({
  open,
  anchorRef,
  onClose,
  className,
  gap,
  zIndex = 60,
  matchAnchorWidth = true,
  menuRef: externalMenuRef,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  /** When provided, closes on outside pointerdown (not anchor/menu) and Escape. */
  onClose?: () => void;
  /** Class for the positioning wrapper (rarely needed — style the child instead). */
  className?: string;
  gap?: number;
  zIndex?: number;
  matchAnchorWidth?: boolean;
  /** Caller-owned ref to the menu wrapper (e.g. for its own outside-click checks). */
  menuRef?: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const menuRef = externalMenuRef ?? internalRef;
  const pos = useAnchoredMenuPosition(open, anchorRef, gap);

  // Touch scroll-lock: while a menu is open, block page panning underneath it —
  // the property that makes native <select> feel solid on iOS. JS re-pinning
  // lags the compositor during touch scroll ("stretchy" menu); preventing the
  // pan removes the movement instead of chasing it. The menu's own list (and
  // the anchor input) still receive touches, so internal scrolling works.
  useEffect(() => {
    if (!open) return;
    function onTouchMove(e: TouchEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      if (e.cancelable) e.preventDefault();
    }
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => document.removeEventListener("touchmove", onTouchMove);
  }, [open, anchorRef, menuRef]);

  useEffect(() => {
    if (!open || !onClose) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onClose!();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef, menuRef]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className={cn(className)}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        width: matchAnchorWidth ? pos.width : undefined,
        zIndex,
      }}
    >
      {children}
    </div>,
    document.body
  );
}
