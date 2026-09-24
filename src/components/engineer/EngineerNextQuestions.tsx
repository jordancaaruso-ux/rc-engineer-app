"use client";

import { CornerDownRight, Plus } from "lucide-react";
import { OTHER_OPTIONS_LABEL, OTHER_OPTIONS_QUESTION } from "@/lib/engineer/nextQuestions";

/**
 * The follow-up buttons under the newest answer (founder, 2026-09-24; nextQuestions.ts): the app's
 * own "Other options", then the two or three the Engineer picked for this answer. A tap SENDS —
 * unlike a starter question, which only fills the box — because these are the conversation's next
 * step, the way you'd ask a real engineer "what else?" or "why that?".
 *
 * Outline, never a yellow fill, like the starter chips: they are prompts, and yellow stays on Send.
 */
export function EngineerNextQuestions({
  questions,
  offerOtherOptions,
  disabled,
  onAsk,
}: {
  questions: string[];
  /** False straight after the driver asked for other options — asking again would repeat them. */
  offerOtherOptions: boolean;
  disabled?: boolean;
  onAsk: (question: string) => void;
}) {
  const buttons = [
    ...(offerOtherOptions ? [{ label: OTHER_OPTIONS_LABEL, ask: OTHER_OPTIONS_QUESTION, other: true }] : []),
    ...questions.map((q) => ({ label: q, ask: q, other: false })),
  ];
  if (buttons.length === 0) return null;
  return (
    <div role="group" aria-label="Ask next" data-testid="engineer-next-questions" className="mt-2 flex flex-wrap gap-1.5">
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          disabled={disabled}
          onClick={() => onAsk(b.ask)}
          className="tap-active inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-left text-xs font-medium leading-snug text-foreground transition hover:border-faint disabled:pointer-events-none disabled:opacity-50"
        >
          {b.other ? (
            <Plus className="size-3 shrink-0 text-primary-ink" strokeWidth={2.5} aria-hidden />
          ) : (
            <CornerDownRight className="size-3 shrink-0 text-primary-ink" strokeWidth={2.25} aria-hidden />
          )}
          <span>{b.label}</span>
        </button>
      ))}
    </div>
  );
}
