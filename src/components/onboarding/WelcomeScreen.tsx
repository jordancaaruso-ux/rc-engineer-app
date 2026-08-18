"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, LineChart, Sparkles, Timer, type LucideIcon } from "lucide-react";
import { Eyebrow } from "@/components/ui/panel";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";

/**
 * Welcome screen — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
 *
 * A full-screen overlay shown ONCE on a truly-empty first sign-in (gated by
 * `showIntro`). It frames the app and sells it in one screen, then hands off to
 * the real dashboard where the "Get set up" card leads. Both buttons write
 * `seen`, so it never returns — an unanswered welcome must never be a trap.
 *
 * It's an overlay, not a `/welcome` route: no redirect (so no land-`/`→bounce
 * flash and no extra middleware DB read), no history entry to strand the PWA
 * back-gesture on chrome-less chrome, and the data it needs is already loaded on
 * the dashboard.
 */

const VALUE_BULLETS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Timer,
    title: "Log every run in seconds",
    body: "Your lap times attach themselves — no hand-typing.",
  },
  {
    icon: LineChart,
    title: "Analyze your performance",
    body: "See where you're losing time, run to run.",
  },
  {
    icon: Sparkles,
    title: "Ask the Engineer",
    body: "It reads your setup and tells you what to change.",
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || hidden) return null;

  async function dismiss() {
    setBusy(true);
    setHidden(true);
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "seen" }),
    }).catch(() => {});
    router.refresh();
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col overflow-y-auto bg-background px-5 py-[max(2rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
        <Eyebrow className="text-primary-ink">Welcome</Eyebrow>
        <h1 className="mt-2 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-foreground">
          Your race-day engineer
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Add your car and you’re ready to log runs — everything else you can fill in as you go.
        </p>

        <ul className="mt-7 flex flex-col gap-4">
          {VALUE_BULLETS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex items-start gap-3.5">
              <span
                aria-hidden
                className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-primary-ink"
              >
                <Icon className="size-5" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold leading-snug text-foreground">
                  {title}
                </span>
                <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
                  {body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss()}
          className={primaryButtonClassName(
            "mt-9 w-full gap-1.5 px-4 py-3.5 text-sm disabled:opacity-50"
          )}
        >
          Get set up
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
        </button>
        <div className="mt-1.5 text-center">
          <button
            type="button"
            disabled={busy}
            onClick={() => void dismiss()}
            className="py-2 text-[12.5px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            Look around first
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
