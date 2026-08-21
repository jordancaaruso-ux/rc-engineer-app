"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EngineerStarterQuestion } from "@/lib/engineerStarterQuestions";
import { useReducedMotion } from "@/components/ui/motion";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/** How long one question holds before the card turns to the next. */
const DWELL_MS = 7000;

/**
 * "Ask the Engineer" — one written question at a time, on the phone dashboard.
 *
 * An empty Engineer page asks a driver to be an engineer before they have talked to one, which
 * is why the questions exist at all (`engineerStarterQuestions.ts`, 2026-08-18). This card puts
 * one of them where the driver already is. Tapping opens the Engineer with the full question in
 * the composer — **it does not send**, which matters more here than on the Engineer page: a
 * mis-tap from the dashboard would otherwise spend a request from the monthly cap on a question
 * nobody asked.
 *
 * On a track day it takes the slot under the day card, replacing that card's old "Ask the
 * Engineer about today" footer (founder call 2026-08-20). That footer queued a recap of the
 * figures printed directly above it; these questions ask things the page cannot answer.
 *
 * **It cycles, and the Engineer page's rail deliberately does not.** The rail is a tool you come
 * back to hunting for the chip you used last round, so it is fixed. This card is an invitation
 * — one line, changing slowly, so it is not the same sentence at 9am and 4pm. The rotation stops
 * for good the moment a thumb touches it (the same rule the phone rail uses for its auto-scroll),
 * because a question that changes as you reach for it is a question you did not choose. Reduced
 * motion never rotates at all: it shows the first question and stays there.
 */
export function DashboardAskEngineerCard({
  questions,
}: {
  /** From `selectDashboardStarterQuestions` — already filtered to what the Engineer can answer. */
  questions: EngineerStarterQuestion[];
}) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  const count = questions.length;
  const cycles = count > 1 && !stopped && !reduced;

  useEffect(() => {
    if (!cycles) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, DWELL_MS);
    return () => window.clearInterval(id);
  }, [cycles, count]);

  if (count === 0) return null;

  const question = questions[Math.min(index, count - 1)];

  return (
    <CardPanel>
      <Eyebrow dot="muted">Ask the Engineer</Eyebrow>

      <Link
        href={`/engineer?prompt=${encodeURIComponent(question.text)}`}
        prefetch
        aria-label={question.text}
        onPointerDown={() => setStopped(true)}
        onFocus={() => setStopped(true)}
        className="tap-active mt-1.5 flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 transition hover:border-primary-ink/30"
      >
        <span aria-hidden className="shrink-0 text-primary-ink">
          ✦
        </span>
        {/* Keyed so React remounts it on every turn and the fade replays. `.rc-fade` is
            already gated on prefers-reduced-motion in globals.css. */}
        <span
          key={question.id}
          className="rc-fade min-w-0 flex-1 text-[13.5px] font-semibold leading-snug text-foreground"
          style={{ "--rc-delay": "0ms" } as CSSProperties}
        >
          {question.label}
        </span>
        <ArrowUpRight aria-hidden className="size-[15px] shrink-0 text-faint" strokeWidth={2.2} />
      </Link>

      {count > 1 ? (
        <div className="mt-2 flex items-center gap-1.5" aria-hidden>
          {questions.map((q, i) => (
            <span
              key={q.id}
              className={cn(
                "size-[5px] rounded-full transition-colors",
                i === index ? "bg-muted-foreground" : "bg-border"
              )}
            />
          ))}
        </div>
      ) : null}
    </CardPanel>
  );
}
