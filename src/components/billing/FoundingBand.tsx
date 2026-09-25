"use client";

import { useState } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow, PanelTitle } from "@/components/ui/panel";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import type { FoundingOfferView } from "@/lib/billing/foundingOffer";
import { TIER_LABELS } from "@/lib/brand/brandNames";
import { cn } from "@/lib/utils";

/**
 * The founding-seat band (docs/MONETISATION_NORTH_STAR.md, "Founding seats", 2026-09-25), under
 * the three plans on /join and on the in-app Subscription page. The founder didn't know what
 * must stay put on those pages, so the plans themselves are untouched and the offer is one band
 * beneath them.
 *
 * Words, in order of what a driver needs: what it is, what it costs, the honest comparison (a
 * real price, labelled, never a bare "was"), how many seats and until when, then the button.
 * The count appears only when fewer than ten seats remain. There are no seat numbers.
 *
 * Posts to /api/billing/founding-checkout, which prices the batch from live seats itself; the
 * price printed here is only what was on sale when the page rendered.
 */

const TITLE = `${TIER_LABELS.pro}, for the life of the app.`;
const SMALL_PRINT = "One payment, nothing renews. Full refund in the first 14 days.";

export function FoundingBand({
  offer,
  variant,
  prefillEmail = null,
  fromApp = false,
}: {
  offer: FoundingOfferView;
  /** `door`: the dark signed-out /join. `paper`: the in-app Subscription page. */
  variant: "door" | "paper";
  /** From the app's welcome email (`/join?email=…&from=app`): checkout opens with it. */
  prefillEmail?: string | null;
  fromApp?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/founding-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(prefillEmail ? { email: prefillEmail } : {}),
          ...(fromApp ? { from: "app" } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Something went wrong");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const button = (
    <button
      type="button"
      disabled={busy}
      onClick={() => void start()}
      className={primaryButtonClassName(
        "min-h-[46px] w-full px-5 py-3 text-sm font-semibold normal-case tracking-normal disabled:cursor-not-allowed disabled:opacity-60 md:w-auto md:min-w-[220px]"
      )}
    >
      {busy ? "Redirecting…" : "Get a founding seat"}
    </button>
  );

  const errorLine = error ? (
    <p role="alert" className="text-[13px] leading-snug text-destructive">
      {error}
    </p>
  ) : null;

  if (variant === "door") {
    return (
      <section
        id="founding"
        aria-label="Founding member"
        className="door-sheet scroll-mt-6 flex w-full flex-col gap-4 p-5 text-left md:flex-row md:items-center md:justify-between md:gap-8 md:p-6"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="micro-caps tracking-[0.18em] text-primary-ink">Founding member</p>
          <h2 className="text-[17px] font-semibold leading-snug text-foreground">{TITLE}</h2>
          <p className="text-[13px] leading-snug text-muted-foreground">{offer.seatsLine}</p>
          <p className="text-[11.5px] leading-snug text-faint">
            {SMALL_PRINT}{" "}
            <Link
              href="/terms#founding"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Terms
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2.5 md:items-end">
          {offer.compareLabel && offer.compareAmount ? (
            <p className="text-[12px] text-faint">
              {offer.compareLabel}{" "}
              <s className="tabular-nums decoration-1">{offer.compareAmount}</s>
            </p>
          ) : null}
          <p className="door-price text-foreground">
            {offer.amount}
            <span className="ml-1.5 font-sans text-[12px] font-normal tracking-normal text-faint">
              AUD, once
            </span>
          </p>
          {button}
          {errorLine}
        </div>
      </section>
    );
  }

  return (
    <CardPanel contentClassName="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:gap-8 lg:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <Eyebrow>Founding member</Eyebrow>
        <PanelTitle>{TITLE}</PanelTitle>
        <p className="text-[13px] leading-snug text-muted-foreground">{offer.seatsLine}</p>
        <p className="text-[12px] leading-snug text-muted-foreground">
          {SMALL_PRINT}{" "}
          <Link href="/terms#founding" className="underline underline-offset-2 hover:text-foreground">
            Terms
          </Link>
        </p>
      </div>
      <div className={cn("flex shrink-0 flex-col gap-2.5 md:items-end")}>
        {offer.compareLabel && offer.compareAmount ? (
          <p className="text-[12px] text-muted-foreground">
            {offer.compareLabel}{" "}
            <s className="tabular-nums decoration-1">{offer.compareAmount}</s>
          </p>
        ) : null}
        <p className="flex items-baseline gap-1.5">
          <span className="fig-hero font-bold text-foreground">{offer.amount}</span>
          <span className="text-[12px] text-muted-foreground">AUD, once</span>
        </p>
        {button}
        {errorLine}
      </div>
    </CardPanel>
  );
}
