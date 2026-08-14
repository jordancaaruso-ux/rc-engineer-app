"use client";

import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/Spinner";
import {
  ENGINEER_CHAT_STATUS_FALLBACK,
  engineerChatStatusLabel,
} from "@/lib/engineerPhase5/engineerChatStatus";
import {
  ENGINEER_LOADING_FACTS,
  engineerLoadingFactAt,
  engineerLoadingFactSlot,
} from "@/lib/engineerPhase5/engineerLoadingFacts";

/**
 * The Engineer's pending bubble: spinner + what the server is actually doing, an elapsed
 * counter once the wait is clearly a long one, and rotating trivia during quiet stretches
 * so a 60-second answer never looks frozen.
 *
 * The status line is real — it only ever names work the server is awaiting right now. The
 * fact block is decorative and is kept in its own tinted box under a "While you wait"
 * label so the two can't be confused.
 */

/** Nothing renders for this long, so the instant lap-history path never flashes a spinner. */
const GRACE_MS = 250;
const TICK_MS = 1_000;
const SHOW_TIMER_SEC = 10;
const SLOW_WARNING_SEC = 45;

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
  const [phaseChangedAt, setPhaseChangedAt] = useState(() => Date.now());
  const [statusChanges, setStatusChanges] = useState(0);
  // Random start so two questions in a row don't open on the same fact. Safe from hydration
  // mismatch: this subtree only ever mounts client-side, after a submit.
  const [seed] = useState(() => Math.floor(Math.random() * ENGINEER_LOADING_FACTS.length));

  useEffect(() => {
    const t = setTimeout(() => setPastGrace(true), GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // A new real stage resets the fact idle window and advances the fact cursor.
  useEffect(() => {
    setPhaseChangedAt(Date.now());
    setStatusChanges((c) => c + 1);
  }, [statusPhase]);

  if (!pastGrace) return <div className="min-h-5" aria-hidden />;

  const label = engineerChatStatusLabel(statusPhase) ?? ENGINEER_CHAT_STATUS_FALLBACK;
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const slot = engineerLoadingFactSlot(now - phaseChangedAt);
  const fact = slot === null ? null : engineerLoadingFactAt(seed, statusChanges, slot);

  return (
    <div className="space-y-2">
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

      {fact ? (
        <div aria-hidden className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2">
          <div className="text-[10px] ui-title text-muted-foreground/80">While you wait</div>
          <p
            key={fact}
            className="rc-fade [--rc-delay:0ms] mt-0.5 text-xs leading-snug text-muted-foreground"
          >
            {fact}
          </p>
        </div>
      ) : null}
    </div>
  );
}
