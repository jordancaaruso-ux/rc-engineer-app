import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JrcMark } from "@/components/brand/JrcMark";
import { TelemetryBackground } from "@/components/brand/TelemetryBackground";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { CardPanel } from "@/components/ui/CardPanel";
import { getPricePlansWithAmounts } from "@/lib/stripe";

export const metadata = { title: "JRC Dynamics App — your race-day engineer" };

/**
 * The public landing page (MONETISATION_NORTH_STAR.md Phase 4; rebuilt 2026-08-02 to the locked
 * decision-board picks). One short page in the app's own visual language — Eyebrow section
 * ticks, CardPanel surfaces, yellow strictly for actions. The Engineer exchange is the proof
 * fragment (pick 2C — Jordan supplies the final Q&A; the current one is from a real run).
 * The demo CTA renders only once DEMO_USER_ID is set, so this page ships before the demo seeds.
 *
 * Signed-in visitors — stale links, PWA-cached entries — still bounce to the dashboard.
 */
export default async function WelcomePage(): Promise<ReactNode> {
  const session = await auth();
  if (session?.user) redirect("/");

  const demoReady = Boolean(process.env.DEMO_USER_ID);

  const plans = await getPricePlansWithAmounts();
  const monthly = (tier: "standard" | "pro"): string | null => {
    const p = plans.find((x) => x.tier === tier && x.interval === "month");
    return p?.unitAmount != null && p.currency
      ? new Intl.NumberFormat("en-AU", {
          style: "currency",
          currency: p.currency.toUpperCase(),
        }).format(p.unitAmount / 100)
      : null;
  };
  const standardPrice = monthly("standard");
  const proPrice = monthly("pro");

  return (
    <div className="relative min-h-[100dvh] w-full bg-background">
      {/* Brand backdrop — same treatment as /login, behind everything. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <TelemetryBackground />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 75% at 50% -8%, rgba(255,214,10,0.10), rgba(255,214,10,0) 55%)",
        }}
      />

      {/* Sticky top bar — mark + the one smart door. */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-3">
          <JrcMark variant="yellow" priority className="h-7" />
          <Link
            href="/login?from=/"
            className="rounded-lg border border-border px-3.5 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Open app
          </Link>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-3xl flex-col gap-14 px-5 pb-20 pt-14">
        {/* ── Hero (pick 1A) ─────────────────────────────────────────── */}
        <section className="flex flex-col items-center text-center">
          <h1 className="max-w-[16ch] text-[clamp(30px,7vw,44px)] font-bold leading-[1.08] tracking-tight">
            Your race-day engineer
          </h1>
          <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-muted-foreground">
            Log the run, read the laps, ask what to change. Built at the track by someone who
            races.
          </p>
          <div className="mt-7 flex w-full max-w-sm flex-col items-stretch gap-3">
            <Link href="/join" className={buttonLinkClassName("primary", "text-center")}>
              Get started
            </Link>
            {demoReady ? (
              <Link
                href="/demo"
                prefetch={false}
                className={buttonLinkClassName("outline", "text-center")}
              >
                Try the demo
              </Link>
            ) : null}
          </div>
          {demoReady ? (
            <p className="mt-2 text-xs text-muted-foreground">
              A real driver&rsquo;s 6 months of data — no signup, look at everything.
            </p>
          ) : null}
        </section>

        {/* ── Proof: a real Engineer exchange (pick 2C) ──────────────── */}
        <section aria-label="Example Engineer answer">
          <CardPanel contentClassName="p-4">
            <Eyebrow>Engineer</Eyebrow>
            {/* PLACEHOLDER EXCHANGE — founder supplies the final Q&A before launch. */}
            <div className="mt-3 flex flex-col gap-3">
              <p className="self-end rounded-xl rounded-br-sm border border-border bg-secondary px-3.5 py-2.5 text-[13.5px] text-foreground">
                Reactive over the kerbs, and it won&rsquo;t hold the middle of the corner.
              </p>
              <p className="self-start max-w-[46ch] rounded-xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
                Front sway bar is doing too much on turn-in. Go 1.3&nbsp;&rarr;&nbsp;1.2 and add
                0.5&nbsp;mm rear droop — you&rsquo;ll give up a touch of response but the car will
                stay with you from apex to exit.
              </p>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Answers read your setup, your laps and how the car felt — grounded in a
              founder-verified physics knowledge base, not a chatbot guessing.
            </p>
          </CardPanel>
        </section>

        {/* ── What it does ───────────────────────────────────────────── */}
        <section className="flex flex-col gap-6">
          <div>
            <Eyebrow>Log every run in seconds</Eyebrow>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your lap times attach themselves from LiveRC, Speedhive and MyRCM. Setup, tires and
              how it felt — captured between heats, not typed up at midnight.
            </p>
          </div>
          <div>
            <Eyebrow>See where the time goes</Eyebrow>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Session trends, lap-by-lap comparison, consistency and mistakes — run against run,
              weekend against weekend.
            </p>
          </div>
          <div>
            <Eyebrow>Ask the Engineer</Eyebrow>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              It remembers every run and every setup you&rsquo;ve tried, and answers in values you
              can dial in — springs, oils, droop, camber — with the reasoning to back it.
            </p>
          </div>
        </section>

        {/* ── Credibility (pick 3 — championship pedigree) ───────────── */}
        <section>
          <Eyebrow>Built by a racer</Eyebrow>
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
            Built with 18 years of motorsport experience — state, national and world champion
            across multiple racing disciplines. It exists because nothing like it did, and it&rsquo;s
            tuned at the track every week.
          </p>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Reads Awesomatix, Mugen and Schumacher setup sheets today — unknown chassis start on a
            generic sheet and race the same day.
          </p>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────── */}
        <section>
          <Eyebrow>Pricing</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <CardPanel contentClassName="p-4">
              <p className="text-sm font-semibold">Standard</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">The smart race notebook.</p>
              <p className="mt-2 text-lg font-semibold">
                {standardPrice ?? "—"}
                <span className="text-[12px] font-normal text-muted-foreground">/month</span>
              </p>
            </CardPanel>
            <CardPanel contentClassName="p-4">
              <p className="text-sm font-semibold">Pro</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">The full race engineer.</p>
              <p className="mt-2 text-lg font-semibold">
                {proPrice ?? "—"}
                <span className="text-[12px] font-normal text-muted-foreground">/month</span>
              </p>
            </CardPanel>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Pro is about half a set of tyres a month. Annual gets 2 months free.
          </p>
          <div className="mt-4 flex max-w-sm flex-col gap-2">
            <Link href="/join" className={buttonLinkClassName("primary", "text-center")}>
              Compare plans
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Not for you? Full refund in the first 14 days, no questions.
          </p>
        </section>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <footer className="flex flex-col gap-2 border-t border-border pt-6 text-[13px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </div>
          <p className="text-[11px]">JRC Dynamics App · jrcdynamics.com</p>
        </footer>
      </main>
    </div>
  );
}
