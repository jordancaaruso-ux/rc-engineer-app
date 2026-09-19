"use client";

import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea that grows to fit its content instead of scrolling inside a fixed
 * box — starts at `minRows` and expands as you type. No drag handle.
 * Everything else is a normal `<textarea>`.
 *
 * It re-measures on every input event, not only when a `value` prop changes.
 * That distinction is the whole bug fixed on 2026-09-16: the three boxes that
 * save on blur (the debrief, and run notes in `RunFaces` / `RunDetailPanel`)
 * are UNCONTROLLED — they pass `defaultValue` and never re-render while you
 * type — so a value-only effect measured once at mount and never again. With
 * `overflow: hidden` on top, everything past the second line was invisible AND
 * unscrollable.
 *
 * `maxRows` caps the growth and hands the overflow back to a scrollbar. Use it
 * where the box sits above something the driver still needs to reach (the
 * debrief card is drawn between the day's chart and its runs, and must not push
 * the runs off the screen). Without it the box grows without limit, as before.
 *
 * Re-measures on width change via a ResizeObserver so it sizes correctly even
 * when it mounts hidden (`display:none`) — e.g. inside a wizard step that isn't
 * on screen yet, where `scrollHeight` is 0 until the step becomes visible.
 */
export function AutoGrowTextarea({
  minRows = 2,
  maxRows,
  className,
  value,
  onChange,
  onInput,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number; maxRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Detached / not displayed: scrollHeight is 0 — skip so we don't lock in a
    // collapsed height. The ResizeObserver re-runs this once it becomes visible.
    if (el.scrollHeight === 0) return;
    el.style.height = "auto";
    if (maxRows == null) {
      el.style.height = `${el.scrollHeight}px`;
      return;
    }
    // `scrollHeight` is content + padding, so the ceiling is measured on that
    // basis and the border added back afterwards (everything here is
    // border-box). A `line-height: normal` yields NaN; 1.5em is the fallback.
    const cs = window.getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize) || 16;
    const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const ceiling = lineHeight * maxRows + padding;
    const overflowing = el.scrollHeight > ceiling;
    el.style.height = `${Math.min(el.scrollHeight, ceiling) + border}px`;
    el.style.overflowY = overflowing ? "auto" : "hidden";
  }, [maxRows]);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  // Only react to width changes (typing is handled by the input event below —
  // reacting to height here would loop). A hidden→visible transition or a
  // container resize both change width, prompting a re-measure.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = -1;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  // `input` rather than `change`: it covers typing, paste, cut, undo and
  // autofill, and it fires on an uncontrolled box where nothing re-renders.
  // The caller goes first: the debrief box rewrites its own text here (dot points), and the
  // measure has to be of what it left behind.
  const handleInput: NonNullable<TextareaHTMLAttributes<HTMLTextAreaElement>["onInput"]> = (e) => {
    onInput?.(e);
    resize();
  };

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      onInput={handleInput}
      className={cn("resize-none overflow-hidden", className)}
      {...rest}
    />
  );
}
