"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The Engineer's pending bubble: a spinner, what the server is actually doing, and an elapsed
 * counter once the wait is clearly a long one.
 *
 * The status line is real — it only ever names the stage the chat route has reported
 * (`event: status`), never a guess. The old bubble also rotated trivia through quiet stretches;
 * that filler went with the 2026-08-13 rebuild and is not back.
 */

/** Nothing renders for this long, so a near-instant answer never flashes a spinner. */
const GRACE_MS = 250;
const TICK_MS = 1_000;
const SHOW_TIMER_SEC = 10;
const SLOW_WARNING_SEC = 45;

/** The chat route's stages, in the driver's words. Anything unknown falls back to "Thinking…". */
const STATUS_LABELS: Record<string, string> = {
  preparing: "Reading your runs and the notes…",
  thinking: "Thinking…",
};
const STATUS_FALLBACK = "Thinking…";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EngineerThinkingIndicator({ statusPhase }: { statusPhase: string | null }) {
  // Lazy state, not a ref: refs can't be read during render, and `Date.now()` as a bare
  // useRef argument runs on every re-render.
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [pastGrace, setPastGrace] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPastGrace(true), GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (!pastGrace) return <div className="min-h-5" aria-hidden />;

  const label = (statusPhase && STATUS_LABELS[statusPhase]) || STATUS_FALLBACK;
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));

  return (
    <div role="status" aria-live="polite" className="space-y-1.5">
      <div className="flex items-start gap-2">
        <Spinner size="sm" className="mt-0.5" />
        <span
          key={label}
          className="rc-fade [--rc-delay:0ms] min-w-0 flex-1 text-[13px] leading-snug text-foreground/90"
        >
          {label}
        </span>
        {elapsedSec >= SHOW_TIMER_SEC ? (
          <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatElapsed(elapsedSec)}
          </span>
        ) : null}
      </div>
      {elapsedSec >= SLOW_WARNING_SEC ? (
        <p className="text-xs leading-snug text-muted-foreground">
          Still working — deep questions can take a minute.
        </p>
      ) : null}
    </div>
  );
}
