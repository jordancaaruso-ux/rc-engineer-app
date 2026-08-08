"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import type { DemoSeasonFacts } from "@/lib/demo/demoSeasonFacts";

/**
 * How long the door stays up before the browser navigates to `/api/auth/demo`.
 *
 * This is deliberately added latency (founder call 2026-08-08). The screen exists to tell a
 * visitor whose season they're about to borrow, and the previous version raced past that in
 * whatever time the redirect happened to take — sometimes under 300ms, which is not long
 * enough to read a sentence. The spec rows finish landing at ~1.3s; the rest is reading time.
 *
 * One knob. If the door ever feels slow, lower this rather than trimming the copy.
 */
const HERO_DWELL_MS = 2600;

/**
 * How long after the navigation fires before the manual hatch appears. During the dwell above
 * "Not moving?" would be a lie — nothing is meant to be moving yet — so the escape only shows
 * up once the redirect really is taking longer than it should.
 */
const HATCH_AFTER_MS = HERO_DWELL_MS + 2500;

type SpecRow = { key: string; value: string; mark?: boolean };

/** Only the rows we can actually fill. A missing fact drops its row rather than guessing. */
function buildSpec(facts: DemoSeasonFacts): SpecRow[] {
  const rows: SpecRow[] = [];
  if (facts.driverName) rows.push({ key: "Driver", value: facts.driverName });
  // No "Season" row — the paragraph above the list already says how long it ran, and a spec
  // list that repeats the sentence next to it reads as padding.
  if (facts.runCount) rows.push({ key: "Runs logged", value: String(facts.runCount) });
  if (facts.trackCount) rows.push({ key: "Tracks", value: String(facts.trackCount) });
  rows.push({ key: "Access", value: "Read-only", mark: true });
  return rows;
}

export function DemoEntryScreen({ facts }: { facts: DemoSeasonFacts }) {
  const { data: session, status } = useSession();
  const kicked = useRef(false);
  const [hatchVisible, setHatchVisible] = useState(false);

  /*
   * The "already armed" flag is a ref, NOT state, and that is load-bearing. As state it
   * re-renders, the effect re-runs on the new value, and its cleanup clears the very timeout
   * it just scheduled — the door then sits there forever and the demo never opens. A ref
   * changes no render, so the timers survive to fire.
   */
  useEffect(() => {
    if (status !== "unauthenticated" || kicked.current) return;
    kicked.current = true;
    const go = setTimeout(() => {
      window.location.assign("/api/auth/demo");
    }, HERO_DWELL_MS);
    const hatch = setTimeout(() => setHatchVisible(true), HATCH_AFTER_MS);
    return () => {
      clearTimeout(go);
      clearTimeout(hatch);
    };
  }, [status]);

  if (status === "authenticated" && session?.user && !session.user.isDemo) {
    return (
      <section className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="page-title">You&rsquo;re already signed in</h1>
        <p className="text-sm text-muted-foreground">
          The demo is for visitors — your own garage is better.
        </p>
        <Link href="/" className={buttonLinkClassName("primary")}>
          Open your garage
        </Link>
      </section>
    );
  }

  const spec = buildSpec(facts);
  // Body copy, then the rows, each 120ms behind the last — the same cadence as `.rc-reveal`
  // everywhere else, just hand-wired because this screen has no `.page-body` wrapper.
  const firstRowDelay = 420;

  /*
   * A <section>, not a <main>: AppShell already renders one around every page, and nesting
   * them hands assistive tech two "main" landmarks on the app's very first screen.
   *
   * 100dvh is safe inside it — that <main> is exactly viewport height with no padding of its
   * own on this route, so this fills the screen and centres rather than pushing a scrollbar.
   */
  return (
    <section
      aria-labelledby="demo-door-title"
      className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col justify-center gap-5 px-6 py-10"
    >
      <div className="rc-reveal" style={{ "--rc-delay": "40ms" } as React.CSSProperties}>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-faint">
          Demo garage
        </p>
        <h1 id="demo-door-title" className="demo-door-title mt-3">
          You&rsquo;re taking over someone&rsquo;s season.
        </h1>
      </div>

      <p
        className="rc-reveal text-[15px] leading-relaxed text-muted-foreground"
        style={{ "--rc-delay": "220ms" } as React.CSSProperties}
      >
        {facts.seasonMonths ? `${facts.seasonMonths} months` : "A full season"}{" "}
        of a real driver&rsquo;s racing — every run, every setup change, every answer the
        Engineer gave. Nothing here is yours to break.
      </p>

      <dl className="mt-1 border-t border-border">
        {spec.map((row, i) => (
          <div
            key={row.key}
            className="rc-reveal flex items-baseline justify-between gap-4 border-b border-border/60 py-3"
            style={{ "--rc-delay": `${firstRowDelay + i * 120}ms` } as React.CSSProperties}
          >
            {/* Sora, not JetBrains Mono: the one-voice pass left mono to racing-clock
                figures only (`.lap-figure`), and none of these are lap times. */}
            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
              {row.key}
            </dt>
            <dd
              className={`text-[15px] font-medium tabular-nums ${
                row.mark ? "text-primary" : "text-foreground"
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <div
        className="rc-reveal mt-2 flex flex-col gap-3"
        style={{ "--rc-delay": `${firstRowDelay + spec.length * 120}ms` } as React.CSSProperties}
      >
        {/* Indeterminate on purpose — no aria-valuenow, because there is no honest one. */}
        <div className="demo-door-sweep" role="progressbar" aria-label="Opening the demo garage" />
        {/* Deliberately a plain <a>: this is an API endpoint that must be a full navigation —
            <Link> would client-route/prefetch it and mint tokens it shouldn't. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/demo"
          className={`self-start text-[13px] text-faint underline decoration-border underline-offset-4 transition-opacity duration-500 hover:text-muted-foreground ${
            hatchVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          Not moving? Open it by hand
        </a>
      </div>
    </section>
  );
}
