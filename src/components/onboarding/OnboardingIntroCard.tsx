"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";

/**
 * The arrival moment — docs/ONBOARDING_NORTH_STAR.md (founder-locked
 * 2026-07-22, round 3: no full-screen takeover; the app IS the tour).
 *
 * A truly-empty first sign-in lands on the real dashboard with this card on
 * top. "Start with your name" begins the guided intro at Settings; "I'll look
 * around first" burns the card (state.seen) so `/` never nags with it again —
 * the resume checklist and guide chip carry it from there. Either button
 * writes `seen`, because an unanswered intro card was the old wizard's trap.
 */
export function OnboardingIntroCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  async function markSeen() {
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seen" }),
    }).catch(() => {});
  }

  async function start() {
    setBusy(true);
    await markSeen();
    router.push("/settings");
  }

  async function lookAround() {
    setBusy(true);
    setHidden(true);
    await markSeen();
    router.refresh();
  }

  return (
    <CardPanel className="border-primary/35">
      <Eyebrow>Welcome</Eyebrow>
      <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em]">
        Let’s get your garage ready
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        Four quick things, all inside the app — so your first run takes seconds to log and your
        laps attach on their own. Follow the yellow.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void start()}
        className={primaryButtonClassName("mt-3.5 w-full gap-1.5 px-4 py-3 text-sm disabled:opacity-50")}
      >
        Start with your name
        <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
      </button>
      <div className="mt-1 text-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => void lookAround()}
          className="py-1.5 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          I’ll look around first
        </button>
      </div>
    </CardPanel>
  );
}
