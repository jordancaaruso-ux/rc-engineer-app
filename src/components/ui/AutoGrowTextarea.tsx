"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea that grows to fit its content instead of scrolling inside a fixed
 * box — starts at `minRows` and expands as you type (or when `value` is set
 * programmatically, e.g. copy-last-run / draft hydrate). No inner scrollbar, no
 * drag handle. Everything else is a normal `<textarea>`.
 */
export function AutoGrowTextarea({
  minRows = 2,
  className,
  value,
  onChange,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
