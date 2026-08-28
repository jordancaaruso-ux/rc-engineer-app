"use client";

import Link from "next/link";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";

/**
 * What a demo visitor gets where the composer would be.
 *
 * The demo used to accept two live Engineer questions a visitor (MONETISATION_NORTH_STAR.md
 * Phase 3). Founder call 2026-08-25 retired that: the demo doesn't need to answer anything, it
 * needs a really good record of questions it has already answered. That is a better pitch AND a
 * simpler product — the demo becomes genuinely read-only, with no per-IP throttle, no global
 * spend ceiling, and no way for a launch-day crowd to make the Engineer go dark.
 *
 * So the composer is replaced rather than disabled. A greyed-out text box invites a visitor to
 * try typing in it and be refused, which is the worst version of this moment; a sentence about
 * whose answers these are, and a door, is the best one.
 *
 * Tone follows `DEMO_READ_ONLY_MESSAGE` — state the fact, let the banner do the selling. This
 * one carries a door because it sits at the bottom of a conversation the visitor just read, and
 * that is the moment the pitch actually lands.
 */
export function DemoEngineerReadingNote() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/25 px-4 py-3.5">
      <p className="text-sm font-medium text-foreground">
        You&rsquo;re reading someone else&rsquo;s answers.
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Every one of these was written for this driver&rsquo;s car, on these runs. In your own
        garage the Engineer reads your setups and your lap times, and answers about yours.
      </p>
      <Link
        href="/join"
        prefetch={false}
        className={`${buttonLinkClassName("primary")} mt-3 inline-flex`}
      >
        Get your own garage
      </Link>
    </div>
  );
}

/**
 * The desktop empty state's demo twin. The real one says "Ask the Engineer about your car" over a
 * board of starter questions — an instruction a demo visitor cannot follow, above controls that
 * would refuse them. This points at the thing that IS there.
 *
 * Carries the door itself, and the note above is suppressed while this is on screen. Driven at
 * 1280px before that split: with both showing, an unopened panel stacked two paragraphs saying
 * near enough the same thing at opposite ends of a tall empty card. One of them belongs under a
 * conversation you have just read — which is where the pitch actually lands — and the other
 * belongs here, where the job is simply "pick one".
 */
export function DemoEngineerEmptyState() {
  return (
    <div className="hidden lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:items-center lg:justify-center lg:gap-2 lg:px-8 lg:text-center">
      <p className="text-sm font-medium text-foreground">A season of answered questions.</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
        Pick any conversation on the left to read what the Engineer told this driver — and what it
        read off their runs before answering.
      </p>
      <Link
        href="/join"
        prefetch={false}
        className={`${buttonLinkClassName("outline")} mt-3`}
      >
        Get your own garage
      </Link>
    </div>
  );
}
