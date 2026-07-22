"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import type { OnboardingProgress } from "@/lib/onboarding/progress";

/**
 * The quiet payoff — docs/ONBOARDING_NORTH_STAR.md (founder 2026-07-22:
 * "quiet and confident", no confetti). Shows once every step is done and no
 * run exists yet; the CTA marks onboarding complete and hands off to run 1.
 * A first run makes it disappear on its own even if the CTA was never tapped.
 */
export function OnboardingPayoffCard({ progress }: { progress: OnboardingProgress }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logFirstRun() {
    setBusy(true);
    // Fire-and-forget: completing is bookkeeping, the run is the point.
    void fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", skippedSteps: [] }),
    }).catch(() => {});
    router.push("/runs/new");
  }

  return (
    <CardPanel className="border-primary/40">
      <Eyebrow className="text-primary">Garage ready</Eyebrow>
      <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em]">
        You’re set — your first run is mostly filled in already
      </h2>
      <ul className="mt-2.5 flex flex-col">
        {progress.steps.map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-t border-border py-2.5 first:border-t-0">
            <span
              aria-hidden
              className="grid size-5 shrink-0 place-items-center rounded-full border border-primary bg-primary text-primary-foreground"
            >
              <Check className="size-3" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">
              {s.meta}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={() => void logFirstRun()}
        className={primaryButtonClassName("mt-3 w-full gap-1.5 px-4 py-3 text-sm disabled:opacity-50")}
      >
        Log your first run
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
      </button>
    </CardPanel>
  );
}
