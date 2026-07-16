"use client";

import { useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea that grows to fit its content instead of scrolling inside a fixed
 * box — starts at `minRows` and expands as you type (or when `value` is set
 * programmatically, e.g. copy-last-run / draft hydrate). No inner scrollbar, no
 * drag handle. Everything else is a normal `<textarea>`.
 *
 * Re-measures on width change via a ResizeObserver so it sizes correctly even
 * when it mounts hidden (`display:none`) — e.g. inside a wizard step that isn't
 * on screen yet, where `scrollHeight` is 0 until the step becomes visible.
 */
export function AutoGrowTextarea({
  minRows = 2,
  className,
  value,
  onChange,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Detached / not displayed: scrollHeight is 0 — skip so we don't lock in a
    // collapsed height. The ResizeObserver re-runs this once it becomes visible.
    if (el.scrollHeight === 0) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  // Only react to width changes (typing changes height, which resize() handles
  // via the value effect — reacting to that here would loop). A hidden→visible
  // transition or a container resize both change width, prompting a re-measure.
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

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      className={cn("resize-none overflow-hidden", className)}
      {...rest}
    />
  );
}
