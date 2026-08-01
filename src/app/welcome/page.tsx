import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JrcMark } from "@/components/brand/JrcMark";
import { TelemetryBackground } from "@/components/brand/TelemetryBackground";
import { buttonLinkClassName } from "@/components/ui/ButtonLink";
import { getPricePlansWithAmounts } from "@/lib/stripe";

export const metadata = { title: "JRC Engineer — your race-day engineer" };

/**
 * The public landing page (MONETISATION_NORTH_STAR.md, Phase 4) — where an unauthenticated `/`
 * now lands. One screen: what it is, three value points (same trio as the in-app welcome
 * overlay), pricing, Get started → /join. Payment is the only door, so this page's whole job is
 * to make /join worth tapping. The demo button slots in here when Phase 3 ships.
 *
 * This route was the retired set-up wizard's stub (2026-07-22 → /); signed-in visitors — stale
 * links, PWA-cached entries — still bounce to the dashboard.
 */
export default async function WelcomePage(): Promise<ReactNode> {
  const session = await auth();
  if (session?.user) redirect("/");

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

  const values: Array<{ title: string; line: string }> = [
    { title: "Log every run in seconds", line: "Your lap times attach themselves — no hand-typing." },
    { title: "Analyze your performance", line: "See where you're losing time, run to run." },
    { title: "Ask the Engineer", line: "It reads your setup and tells you what to change." },
  ];

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      {/* Same brand treatment as /login — telemetry backdrop, hero whisper, hairline. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <TelemetryBackground />
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(115% 75% at 50% -8%, rgba(255,214,10,0.12), rgba(255,214,10,0) 55%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent"
      />

      <div className="relative z-10 w-full max-w-[420px]">
        <div className="flex flex-col items-center text-center">
          <JrcMark variant="yellow" priority className="h-12" />
          <h1 className="mt-7 text-2xl font-semibold tracking-tight">Your race-day engineer</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The smart notebook for RC racing — every run logged, every setup remembered, and an
            engineer that reads them all.
          </p>
        </div>

        <ul className="mt-8 flex flex-col gap-4">
          {values.map((v) => (
            <li key={v.title} className="flex gap-3">
              <span aria-hidden="true" className="mt-0.5 text-primary">
                ✓
              </span>
              <div>
                <p className="text-sm font-semibold">{v.title}</p>
                <p className="text-sm text-muted-foreground">{v.line}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-8 rounded-2xl border border-border bg-background/70 p-5 backdrop-blur-xl">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Standard</p>
            <p className="text-sm text-muted-foreground">
              {standardPrice ? `${standardPrice}/month` : "Coming soon"}
            </p>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold">Pro</p>
            <p className="text-sm text-muted-foreground">
              {proPrice ? `${proPrice}/month` : "Coming soon"}
            </p>
          </div>
          <Link href="/join" className={buttonLinkClassName("primary", "mt-5 w-full text-center")}>
            Get started
          </Link>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Not for you? Full refund in the first 14 days, no questions.
          </p>
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already racing with us?{" "}
          <Link href="/login" className="text-accent underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
