"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { cn } from "@/lib/utils";
import type { OnboardingProgress } from "@/lib/onboarding/progress";

/**
 * Dashboard resume card — docs/ONBOARDING_NORTH_STAR.md.
 *
 * Shown only while the garage is unfinished. Founder-locked 2026-07-22: keep
 * the card, but let them ignore it ("keep it but able to click ignore") — one
 * tap and it never comes back, so it can't turn into a nag. It also disappears
 * on its own the moment the last step is done, because progress is derived from
 * what they actually have, not a stored counter.
 */
export function OnboardingResumeCard({ progress }: { progress: OnboardingProgress }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden || !progress.showResumeCard) return null;

  async function ignore() {
    setBusy(true);
    setHidden(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss-resume" }),
      });
      router.refresh();
    } catch {
      // Already hidden locally; a failed write just means it returns next load.
    } finally {
      setBusy(false);
    }
  }

  const pct = Math.round((progress.doneCount / progress.total) * 100);

  return (
    <CardPanel className="border-primary/25">
      <div className="flex items-center gap-2">
        <Eyebrow>Finish setting up</Eyebrow>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {progress.doneCount} of {progress.total}
        </span>
      </div>

      <div
        className="mt-3 h-[7px] overflow-hidden rounded-[4px] bg-muted"
        role="progressbar"
        aria-valuenow={progress.doneCount}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label="Setup progress"
      >
        <span
          aria-hidden
          className="block h-full rounded-[4px] bg-primary transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-3 flex flex-col">
        {progress.steps.map((s) => {
          const isNext = s.id === progress.nextStep?.id;
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                className={cn(
                  "flex items-center gap-3 border-t border-border py-3 transition first:border-t-0",
                  "hover:bg-foreground/[0.03]"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border text-[11px]",
                    s.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : isNext
                        ? "border-primary text-primary"
                        : "border-border text-faint"
                  )}
                >
                  {s.done ? <Check className="size-3" strokeWidth={3} /> : isNext ? "▸" : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm font-semibold",
                      s.done ? "text-muted-foreground" : "text-foreground"
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted-foreground">
                    {s.meta}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn("shrink-0 text-[15px]", isNext ? "text-primary" : "text-faint")}
                >
                  ›
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        {/* Deep-link straight to the next real surface — the wizard is gone
            (2026-07-22 round 3); the guide chip takes over from there. */}
        <Link
          href={progress.nextStep?.href ?? "/"}
          className={primaryButtonClassName("flex-1 gap-1.5 px-3 py-2.5 text-[13px]")}
        >
          Pick up where I left off
          <ArrowRight aria-hidden className="size-3.5" strokeWidth={2.4} />
        </Link>
        <button
          type="button"
          onClick={() => void ignore()}
          disabled={busy}
          className="px-3 py-2.5 text-[13px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          Ignore
        </button>
      </div>
    </CardPanel>
  );
}
