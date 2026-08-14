import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JrcMark } from "@/components/brand/JrcMark";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { Eyebrow } from "@/components/ui/panel";
import { CardPanel } from "@/components/ui/CardPanel";
import { getPricePlansWithAmounts } from "@/lib/stripe";
import { COMPANY_NAME, PRODUCT_NAME, TIER_LABELS } from "@/lib/brand/brandNames";

export const metadata = { title: `${PRODUCT_NAME} — your next tenth is in the data` };

/**
 * SUPERSEDED 2026-08-06 AND UNREACHABLE. `/welcome` is rewritten to `public/landing/index.html`
 * by the `beforeFiles` rule in next.config.mjs, so nothing renders this file. Kept because it is
 * the only version that reads prices live from Stripe — the static page hardcodes them. To bring
 * it back, delete that one rewrite; the signed-in bounce below is now duplicated in middleware.ts
 * and would need removing there too.
 *
 * The public landing page — Jordan's own marketing site (artifact "JRC Engineering Marketing",
 * merged 2026-08-02) ported into the app and converted from waitlist-era CTAs to the paid door.
 * His copy verbatim wherever it existed; pricing, pedigree and the demo door are the additions
 * a waitlist page never needed. Demo CTAs render only once DEMO_USER_ID is set.
 *
 * Signed-in visitors — stale links, PWA-cached entries — bounce to the dashboard.
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

  return (
    <div className="relative min-h-[100dvh] w-full bg-background">
      {/* TITC sunset backdrop (founder pick 2026-08-02) — the same baked photo the app's
          "photo" background mode uses (blur + grade baked into the JPEG; scrim + vignette
          here because they're viewport-relative). Fixed so it holds through the scroll. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{ background: "url(/brand/track-hero-baked.jpg) center / cover no-repeat" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{ background: "rgb(18 17 16 / 0.62)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0"
        style={{
          background: "radial-gradient(130% 120% at 50% 40%, transparent 55%, rgba(0,0,0,0.45))",
        }}
      />

      {/* Persistent bar: mark + the demo door + the app door (founder ask 2026-08-02). */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-5 py-3">
          <JrcMark variant="yellow" priority className="h-7" />
          <div className="flex items-center gap-2">
            {demoReady ? (
              <Link
                href="/demo"
                prefetch={false}
                className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Try the demo
              </Link>
            ) : null}
            <Link
              href="/login?from=/"
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
            >
              Open app
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex max-w-4xl flex-col gap-16 px-5 pb-20 pt-12">
        {/* ── Hero (Jordan's headline) ───────────────────────────────── */}
        <section className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <h1 className="max-w-[14ch] text-[clamp(32px,6vw,46px)] font-bold leading-[1.06] tracking-tight">
              Your next tenth is in the data.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-muted-foreground">
              Session trends, lap analysis, and AI setup calls — from the runs you&rsquo;re already
              doing. {PRODUCT_NAME} turns every practice day into lap time you can point to.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/join" className={buttonLinkClassName("primary")}>
                Get started
              </Link>
              {demoReady ? (
                <Link href="/demo" prefetch={false} className={buttonLinkClassName("outline")}>
                  Try the demo
                </Link>
              ) : null}
            </div>
            {demoReady ? (
              <p className="mt-2 text-xs text-muted-foreground">
                The demo is a real driver&rsquo;s 6 months of data — no signup.
              </p>
            ) : null}
          </div>

          {/* Session-trend instrument (Jordan's hero widget, static). */}
          <CardPanel contentClassName="p-4">
            <div className="flex items-center justify-between gap-2">
              <Eyebrow className="mb-0 border-b-0 pb-0">Session trend</Eyebrow>
              <span className="tabular-nums text-[10px] text-muted-foreground">R8 · Q2 · MOD TC</span>
            </div>
            <svg viewBox="0 0 300 90" className="mt-3 block w-full" aria-hidden="true">
              <line x1="0" y1="22" x2="300" y2="22" stroke="#282726" strokeWidth="1" />
              <line x1="0" y1="45" x2="300" y2="45" stroke="#282726" strokeWidth="1" />
              <line x1="0" y1="68" x2="300" y2="68" stroke="#282726" strokeWidth="1" />
              <polyline
                points="10,24 50,34 90,30 130,48 170,44 210,62 250,58 290,74"
                fill="none"
                stroke="rgb(var(--color-foreground))"
                strokeWidth="2"
              />
              <circle cx="290" cy="74" r="3.5" fill="rgb(var(--color-primary-ink))" />
            </svg>
            <div className="mt-3 grid grid-cols-3 overflow-hidden rounded-lg border border-border">
              {(
                [
                  ["Best lap", "14.980"],
                  ["Consistency", "94.2%"],
                  ["Runs logged", "8"],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="border-r border-border px-3 py-2 last:border-r-0">
                  <div className="text-[10px] font-semibold text-muted-foreground">{label}</div>
                  <div className="fig-stat font-semibold">{value}</div>
                </div>
              ))}
            </div>
          </CardPanel>
        </section>

        {/* ── The problem ────────────────────────────────────────────── */}
        <section>
          <Eyebrow>The problem</Eyebrow>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">
            Gut feel doesn&rsquo;t find tenths.
          </h2>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
            Ten runs a day, three changes a run, nothing written down. Pace comes and goes and
            nobody knows why. Log it once — the pattern is obvious.
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <CardPanel contentClassName="p-4">
              <div className="flex items-center justify-between">
                <span className="micro-caps text-muted-foreground">
                  Racing on gut feel
                </span>
                <span className="tabular-nums text-[12px] text-muted-foreground">Δ ?</span>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li>
                  <span className="text-foreground">&ldquo;It felt quicker.&rdquo;</span>{" "}
                  <span className="text-muted-foreground">— was it?</span>
                </li>
                <li>
                  <span className="text-foreground">&ldquo;Tires went off.&rdquo;</span>{" "}
                  <span className="text-muted-foreground">— which run?</span>
                </li>
                <li>
                  <span className="text-foreground">&ldquo;I changed three things.&rdquo;</span>{" "}
                  <span className="text-muted-foreground">— which one worked?</span>
                </li>
              </ul>
            </CardPanel>
            <CardPanel contentClassName="p-4">
              <div className="flex items-center justify-between">
                <span className="micro-caps text-muted-foreground">
                  Racing on data
                </span>
                <span className="tabular-nums text-[12px] text-gain">▼ −0.18s</span>
              </div>
              <ul className="mt-3 flex flex-col gap-2 text-[13.5px] leading-relaxed">
                <li className="tabular-nums text-[13px]">
                  R5 → R6: front camber −1.5° → −2.0°
                </li>
                <li className="text-muted-foreground">
                  Avg top 5 <span className="text-gain">−0.18s</span> · consistency{" "}
                  <span className="text-gain">+2.1%</span>
                </li>
                <li>
                  <span className="text-foreground">Kept for Q3.</span>{" "}
                  <span className="text-muted-foreground">Written down. Repeatable.</span>
                </li>
              </ul>
            </CardPanel>
          </div>
        </section>

        {/* ── Session analysis ───────────────────────────────────────── */}
        <section>
          <Eyebrow>Session analysis</Eyebrow>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Compare runs. Spot what changed.</h2>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
            Every setup change is marked on the timeline, next to what it did to your pace. No more
            &ldquo;I think that helped.&rdquo;
          </p>
          <ul className="mt-4 flex max-w-[60ch] flex-col gap-2 text-sm text-muted-foreground">
            <li>· Pace, consistency, and mistakes — three lenses on every session</li>
            <li>· Setup changes and tire sets marked run by run</li>
            <li>· Track progress across events, cars, and seasons</li>
            <li>· Lap times attach themselves from LiveRC, Speedhive and MyRCM</li>
          </ul>
        </section>

        {/* ── AI race engineer (Jordan's mock exchange) ──────────────── */}
        <section>
          <Eyebrow>AI race engineer</Eyebrow>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">
            Setup calls that earn their place.
          </h2>
          <p className="mt-2 max-w-[56ch] text-sm leading-relaxed text-muted-foreground">
            Describe the handling, get a recommendation grounded in your own runs — per car, per
            track, per condition. Then argue with it.
          </p>
          <CardPanel className="mt-5" contentClassName="p-4">
            <div className="micro-caps text-muted-foreground">
              Engineer · Mod TC
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <p className="self-end rounded-xl rounded-br-sm border border-border bg-secondary px-3.5 py-2.5 text-[13.5px]">
                Losing the front mid-corner once the tires go off. R6 onward.
              </p>
              <div className="self-start max-w-[48ch] rounded-xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-[13.5px] leading-relaxed">
                <p>
                  Your last three runs show mid-corner speed dropping ~0.3s after lap 8 while entry
                  stays consistent — classic front grip fade. Two changes:
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums text-[12px]">
                  <div className="rounded-md border border-border px-2 py-1.5">
                    Front camber
                    <div className="text-foreground">−1.5° → −2.0°</div>
                  </div>
                  <div className="rounded-md border border-border px-2 py-1.5">
                    Front shock oil
                    <div className="text-foreground">400 → 350 cSt</div>
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Data-driven tuning suggestions, not forum folklore — grounded in a founder-verified
              physics knowledge base. Ask why. Push back. One tap writes the change onto your setup
              sheet.
            </p>
          </CardPanel>
        </section>

        {/* ── How it works ───────────────────────────────────────────── */}
        <section>
          <Eyebrow>How it works</Eyebrow>
          <h2 className="mt-3 text-2xl font-bold tracking-tight">Log. Read. Tune. Repeat.</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["01", "Log the run", "Laps, tires, setup, conditions — captured trackside in seconds."],
                ["02", "Read the session", "Pace, consistency, mistakes — three honest lenses on the day."],
                ["03", "Get the call", "Setup suggestions from your own data — per car, per track."],
                ["04", "Go faster", "Ship the change, log the next run, watch the delta go green."],
              ] as const
            ).map(([n, title, line]) => (
              <div key={n} className="rounded-xl border border-border p-4">
                <div className="tabular-nums text-[11px] text-primary-ink">{n}</div>
                <p className="mt-1 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{line}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Built by a racer ───────────────────────────────────────── */}
        <section>
          <Eyebrow>Built by a racer</Eyebrow>
          <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
            Built with 18 years of motorsport experience — state, national and world champion
            across multiple racing disciplines. It exists because nothing like it did, and
            it&rsquo;s tuned at the track every week.
          </p>
        </section>

        {/* ── Pricing ────────────────────────────────────────────────── */}
        <section>
          <Eyebrow>Pricing</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <CardPanel contentClassName="p-4">
              <p className="text-sm font-semibold">{TIER_LABELS.standard}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">The smart race notebook.</p>
              <p className="mt-2 text-lg font-semibold">
                {monthly("standard") ?? "—"}
                <span className="text-[12px] font-normal text-muted-foreground">/month</span>
              </p>
            </CardPanel>
            <CardPanel contentClassName="p-4">
              <p className="text-sm font-semibold">{TIER_LABELS.pro}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">The full race engineer.</p>
              <p className="mt-2 text-lg font-semibold">
                {monthly("pro") ?? "—"}
                <span className="text-[12px] font-normal text-muted-foreground">/month</span>
              </p>
            </CardPanel>
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            {TIER_LABELS.pro} costs less than a set of tyres, and the questions are yours to spend
            how you like. Annual gets 2 months free. Not for you? Full refund in the first 14 days,
            no questions.
          </p>
        </section>

        {/* ── Final door ─────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border bg-card/60 p-6 text-center">
          <h2 className="text-2xl font-bold tracking-tight">Get on the grid.</h2>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-muted-foreground">
            Bring your lap times — the first run takes seconds to log.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/join" className={buttonLinkClassName("primary")}>
              Get started
            </Link>
            {demoReady ? (
              <Link href="/demo" prefetch={false} className={buttonLinkClassName("outline")}>
                Try the demo
              </Link>
            ) : null}
          </div>
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
          <p className="micro-caps">
            © 2026 {COMPANY_NAME} · Built by racers
          </p>
        </footer>
      </main>
    </div>
  );
}
