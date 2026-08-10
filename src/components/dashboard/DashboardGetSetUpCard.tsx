"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { UploadSetupSheetBar, type UploadSetupCar } from "@/components/setup/UploadSetupSheetBar";
import { cn } from "@/lib/utils";

/**
 * "Get set up" card — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23).
 *
 * The single first-run surface that replaced the guide chip + resume/payoff cards.
 * Only a CAR is required to log a run, so the car gates the payoff: the moment a
 * car exists the card flips to "You're ready — log your first run", with the
 * TIMING and SETUP rows persisting beneath as strongly-advised extras (they nudge,
 * never gate). Every row navigates — no dead taps. All state is derived, so the
 * card self-retires once car + timing + setup are all in, a run exists, or Ignore.
 *
 * The Setup row delegates entirely to `UploadSetupSheetBar`, which already branches
 * per car: a green-lit chassis opens the photo/PDF/paste doors, everything else
 * routes to the hand-build create-a-setup flow — so the "quick upload vs. slower
 * build" adaptivity lives in one place, not here.
 */
type Props = {
  hasCar: boolean;
  hasTimingIdentity: boolean;
  hasSetup: boolean;
  /** Cars for the adaptive setup flow; empty once a setup exists or there's no car. */
  setupCars: UploadSetupCar[];
};

function RowBody({
  done,
  title,
  meta,
  tone = "advised",
}: {
  done: boolean;
  title: string;
  meta: string;
  tone?: "required" | "advised";
}) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full border",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : tone === "required"
              ? "border-primary/60 text-primary"
              : "border-border text-muted-foreground"
        )}
      >
        {done ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold leading-snug text-foreground">{title}</span>
        <span className="block truncate text-[12px] leading-snug text-muted-foreground">{meta}</span>
      </span>
    </span>
  );
}

function LinkRow({
  href,
  done,
  title,
  meta,
  tone,
}: {
  href: string;
  done: boolean;
  title: string;
  meta: string;
  tone?: "required" | "advised";
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5 transition hover:bg-card"
    >
      <RowBody done={done} title={title} meta={meta} tone={tone} />
      {!done ? (
        <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.2} />
      ) : null}
    </Link>
  );
}

export function DashboardGetSetUpCard({ hasCar, hasTimingIdentity, hasSetup, setupCars }: Props) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    setHidden(true);
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss-resume" }),
    }).catch(() => {});
    router.refresh();
  }

  const canUpload = setupCars.some((c) => c.supportsUpload);
  const setupMeta = hasSetup
    ? "The Engineer can read your actual car"
    : !hasCar
      ? "Add a car first"
      : canUpload
        ? "Upload your sheet — the fillable PDF, about 30 seconds"
        : "Build it in the app — a few minutes";

  const timingRow = (
    <LinkRow
      href="/settings"
      done={hasTimingIdentity}
      title="Add your timing details"
      meta={
        hasTimingIdentity
          ? "Laps attach to you on their own"
          : "Name + transponder so laps attach on their own"
      }
    />
  );

  // The Setup action IS the upload bar (adaptive per chassis). Only actionable once
  // there's a car and no setup yet; otherwise a plain (done or muted) row.
  const setupRow =
    hasCar && !hasSetup && setupCars.length > 0 ? (
      <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5">
        <RowBody done={false} title="Add a setup sheet" meta={setupMeta} />
        <div className="mt-2.5">
          <UploadSetupSheetBar cars={setupCars} />
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card/60 px-3 py-2.5">
        <RowBody done={hasSetup} title="Add a setup sheet" meta={setupMeta} />
      </div>
    );

  return (
    <CardPanel className="border-primary/30">
      <div className="flex items-center gap-2">
        <Eyebrow className={hasCar ? "text-primary" : undefined}>
          {hasCar ? "Ready to run" : "Get set up"}
        </Eyebrow>
        <button
          type="button"
          disabled={busy}
          onClick={() => void dismiss()}
          className="ml-auto text-[11px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          Ignore
        </button>
      </div>

      {hasCar ? (
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            You’re ready — log your first run
          </h2>
          <ButtonLink href="/runs/new" className="mt-3 w-full gap-1.5 px-4 py-3 text-sm">
            Log your first run
            <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
          </ButtonLink>

          {!hasTimingIdentity || !hasSetup ? (
            <>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Make it better
              </p>
              <div className="mt-2 flex flex-col gap-2">
                {!hasTimingIdentity ? timingRow : null}
                {!hasSetup ? setupRow : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            Add your car to log your first run
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Runs attach to a car — it’s the one thing we can’t guess. The rest is optional and just
            makes your runs sharper.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <LinkRow
              href="/cars"
              done={false}
              title="Add your car"
              meta="Takes about twenty seconds"
              tone="required"
            />
            {timingRow}
            {setupRow}
          </div>
        </>
      )}
    </CardPanel>
  );
}
