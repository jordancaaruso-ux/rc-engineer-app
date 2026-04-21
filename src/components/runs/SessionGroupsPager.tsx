"use client";

import React, { useState } from "react";

/**
 * Client-side pager for the Sessions page. The full group list is still
 * rendered server-side (so SSR is complete + search-engine friendly), but
 * this wrapper initially mounts only the first `initial` groups and reveals
 * the rest on demand. Keeps initial JS + DOM cost down when users have many
 * testing days / race meetings on record.
 *
 * The children MUST be stable-ordered; we rely on React.Children.toArray
 * to preserve keys provided by the caller.
 */
export function SessionGroupsPager({
  initial = 8,
  step = 12,
  children,
}: {
  initial?: number;
  step?: number;
  children: React.ReactNode;
}) {
  const items = React.Children.toArray(children);
  const [count, setCount] = useState(initial);

  if (items.length === 0) return null;
  if (items.length <= count) return <>{items}</>;

  const visible = items.slice(0, count);
  const hiddenCount = items.length - count;
  const revealNext = Math.min(hiddenCount, step);

  return (
    <>
      {visible}
      <div className="flex items-center justify-center pt-2">
        <button
          type="button"
          onClick={() => setCount((c) => c + step)}
          className="rounded-lg border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-muted/60 transition"
        >
          Show {revealNext} more · {hiddenCount} older session{hiddenCount === 1 ? "" : "s"}
        </button>
      </div>
    </>
  );
}
