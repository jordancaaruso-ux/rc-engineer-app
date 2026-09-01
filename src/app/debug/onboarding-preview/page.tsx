"use client";

/**
 * Dev preview for the first-run surfaces (docs/ONBOARDING_NORTH_STAR.md, reversal
 * 2026-07-23). Onboarding is the one flow you can't re-experience on your own
 * account — the admin reset only clears `seen`/`dismissed`, and both gates also
 * read `hasCar`/`hasAnyRun`, so on an account with data a reset shows you nothing.
 * That's why reviewing a copy tweak used to mean creating a throwaway account.
 *
 * This drives every state against the REAL components with fabricated props, so
 * what you're judging is the shipped card, not a mock-up. `window.fetch` is stubbed
 * for `/api/onboarding` only — Ignore and the welcome buttons behave exactly as
 * they do in production but write nothing to your account.
 *
 * What this canNOT cover, and still needs one drive on a fresh account: the
 * magic-link first sign-in, `seen` actually persisting, and the /cars → add car →
 * card-flips-to-payoff sequence.
 */

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { DashboardGetSetUpCard } from "@/components/dashboard/DashboardGetSetUpCard";
import { WelcomeScreen } from "@/components/onboarding/WelcomeScreen";
import type { UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";
import {
  isReadyToRun,
  isSetUpComplete,
  showGetSetUpCard,
  showWelcomeScreen,
  type OnboardingFacts,
} from "@/lib/onboarding/visibility";

/** Green-lit chassis with baselines — all three doors live. */
const UPLOADABLE_CAR: UploadSetupCar = {
  id: "preview_car_uploadable",
  name: "Mugen MTC3",
  chassisName: "Mugen MTC3",
  supportsUpload: true,
  baselineCount: 3,
  priorSetupCount: 4,
};

/** Nothing to read a sheet with and nothing to copy — fill-a-blank alone, the other two greyed. */
const HAND_BUILD_CAR: UploadSetupCar = {
  id: "preview_car_handbuild",
  name: "Awesomatix A800",
  chassisName: "Awesomatix A800",
  supportsUpload: false,
  baselineCount: 0,
  priorSetupCount: 0,
};

const EMPTY: OnboardingFacts = {
  seen: false,
  dismissed: false,
  hasCar: false,
  hasTimingIdentity: false,
  hasSetup: false,
  hasAnyRun: false,
};

const facts = (over: Partial<OnboardingFacts>): OnboardingFacts => ({ ...EMPTY, ...over });

type PreviewState = {
  label: string;
  /** Why this state exists / what to look at. */
  note: string;
  facts: OnboardingFacts;
  cars: UploadSetupCar[];
};

const STATES: PreviewState[] = [
  {
    label: "Brand-new account",
    note: "Overlay + card. The only truly required row is the car.",
    facts: EMPTY,
    cars: [],
  },
  {
    label: "Overlay answered, still empty",
    note: "“Look around first” must not silence the card too.",
    facts: facts({ seen: true }),
    cars: [],
  },
  {
    label: "Car added — green-lit chassis",
    note: "Timing is the yellow button now, not the run; setup row offers the 30-second photo upload.",
    facts: facts({ seen: true, hasCar: true }),
    cars: [UPLOADABLE_CAR],
  },
  {
    label: "Car added — chassis with no calibration",
    note: "Same state, hand-build copy. This is the common case today.",
    facts: facts({ seen: true, hasCar: true }),
    cars: [HAND_BUILD_CAR],
  },
  {
    label: "Car + timing, no setup",
    note: "Only the setup row survives under “Make it better”.",
    facts: facts({ seen: true, hasCar: true, hasTimingIdentity: true }),
    cars: [UPLOADABLE_CAR],
  },
  {
    label: "Car + setup, no timing",
    note: "Only the timing row survives — it links to /settings as a whole page.",
    facts: facts({ seen: true, hasCar: true, hasSetup: true }),
    cars: [],
  },
  {
    label: "Garage ready",
    note: "Card STAYS up (amended 2026-08-18) — handing over the run is its last job.",
    facts: facts({ seen: true, hasCar: true, hasTimingIdentity: true, hasSetup: true }),
    cars: [],
  },
  {
    label: "First run logged, garage incomplete",
    note: "The run retires the card even though timing and setup are missing.",
    facts: facts({ seen: true, hasCar: true, hasAnyRun: true }),
    cars: [UPLOADABLE_CAR],
  },
  {
    label: "Ignored",
    note: "Card gone for good; the overlay gate is untouched by Ignore.",
    facts: facts({ seen: true, dismissed: true }),
    cars: [],
  },
];

function Verdict({ f }: { f: OnboardingFacts }) {
  const rows: [string, boolean][] = [
    ["overlay", showWelcomeScreen(f)],
    ["card", showGetSetUpCard(f)],
    ["ready to run", isReadyToRun(f)],
    ["set up", isSetUpComplete(f)],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map(([name, on]) => (
        <span
          key={name}
          className={
            on
              ? "rounded border border-primary-ink/50 px-1.5 py-0.5 type-machine text-[10px] uppercase tracking-[0.08em] text-primary-ink"
              : "rounded border border-border px-1.5 py-0.5 type-machine text-[10px] uppercase tracking-[0.08em] text-muted-foreground"
          }
        >
          {name} {on ? "✓" : "✗"}
        </span>
      ))}
      <span className="rounded border border-border px-1.5 py-0.5 type-machine text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        {f.hasCar ? "payoff face" : "ask face"}
      </span>
    </div>
  );
}

export default function OnboardingPreviewPage() {
  // Dev-only synthetic preview — never exposed in production.
  if (process.env.NODE_ENV === "production") notFound();
  return <OnboardingPreviewInner />;
}

function OnboardingPreviewInner() {
  const [ready, setReady] = useState(false);
  // Bumping the key remounts the overlay, which otherwise stays hidden after its
  // own dismiss — so you can summon it repeatedly while judging copy.
  const [overlayKey, setOverlayKey] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Swallow `seen` / `dismiss-resume` so previewing never marks your own
      // account onboarded. Everything else passes straight through.
      if (url.includes("/api/onboarding")) {
        return new Response(JSON.stringify({ ok: true, preview: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input, init);
    }) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = realFetch;
    };
  }, []);

  return (
    <main className="page-body mx-auto max-w-md space-y-6 p-4">
      <header className="page-header">
        <h1 className="page-title">Onboarding preview</h1>
        <p className="page-subtitle">
          Every first-run state through the real components. Nothing here writes to your account.
          Debug page — not linked from nav.
        </p>
      </header>

      <section className="space-y-2">
        <span className="type-data-label">Welcome overlay</span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => {
            setOverlayKey((k) => k + 1);
            setOverlayOpen(true);
          }}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
        >
          Show the welcome overlay
        </button>
        <p className="text-[11px] text-muted-foreground">
          Both buttons dismiss it — that&apos;s the real behaviour. In production either one writes{" "}
          <code>seen</code> and it never returns.
        </p>
        {ready && overlayOpen ? <WelcomeScreen key={overlayKey} /> : null}
      </section>

      <section className="space-y-4 border-t border-border pt-4">
        <span className="type-data-label">Get-set-up card — every state</span>
        {STATES.map((s) => {
          const visible = showGetSetUpCard(s.facts);
          return (
            // Stable hook for the visual suite (e2e/onboarding-preview.spec.ts) — selecting
            // these blocks by DOM position is fragile, because the wrapper shape differs
            // between a rendered card and the "not shown" placeholder.
            <div key={s.label} data-onboarding-state={s.label} className="space-y-2">
              <div className="space-y-1.5">
                <p className="text-[13px] font-bold text-foreground">{s.label}</p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">{s.note}</p>
                <Verdict f={s.facts} />
              </div>
              {ready && visible ? (
                <DashboardGetSetUpCard
                  hasCar={s.facts.hasCar}
                  hasTimingIdentity={s.facts.hasTimingIdentity}
                  hasSetup={s.facts.hasSetup}
                  setupCars={s.cars}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">
                  Card not shown in this state
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-1.5 border-t border-border pt-4">
        <span className="type-data-label">Still needs a real account</span>
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
          <li>Magic-link first sign-in landing on the dashboard with the overlay up.</li>
          <li>
            <code>seen</code> persisting across a reload (this page stubs that write away).
          </li>
          <li>/cars → add car → back → the card actually flipping to the payoff.</li>
          <li>The just-in-time timing gate at lap ingest (needs a track with discovery).</li>
        </ul>
      </section>
    </main>
  );
}
