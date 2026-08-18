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
import { guardTapsAfterDismiss } from "@/lib/dismissTapGuard";

/**
 * "Get set up" card — docs/ONBOARDING_NORTH_STAR.md (reversal 2026-07-23,
 * amended 2026-08-18).
 *
 * The single first-run surface that replaced the guide chip + resume/payoff cards.
 * Every row navigates — no dead taps; all state is derived, so the card self-retires
 * once a run exists or Ignore is tapped.
 *
 * **The car alone is not the payoff (founder 2026-08-18).** It used to be: adding a
 * car flipped the card straight to "You're ready — log your first run", which was
 * both premature and untrue — with no timing identity their laps do not attach to
 * them, and the run wizard would then refuse to mark the run complete. So the card
 * now walks CAR → TIMING and only then hands over the run. A SETUP SHEET is
 * deliberately not on that path: it is the one item needing something they may not
 * have on them, so it rides along as an advised extra and keeps nagging from
 * `DashboardAddSetupCard` once this card retires.
 *
 * Nothing here gates. The card's own "Log a run anyway" link came out on 2026-08-18
 * (founder): the dock's run control is on screen the whole time, so the escape hatch
 * was a second door to the same room, and printing it under the one thing we're
 * asking for read as an apology for asking. Somebody standing at the track is still
 * never held up by set-up — they just use the dock.
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
            ? "border-primary-ink primary-face bg-primary text-primary-foreground"
            : tone === "required"
              ? "border-primary-ink/60 text-primary-ink"
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
    // The layout closes over the finger the instant this unmounts — see the guard.
    guardTapsAfterDismiss();
    await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss-resume" }),
    }).catch(() => {});
    router.refresh();
  }

  // Mirrors `isReadyToRun` in lib/onboarding/visibility.ts — a car to attach the run
  // to, and the timing identity that makes laps land on them by themselves.
  const readyToRun = hasCar && hasTimingIdentity;

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
    <CardPanel className="border-primary-ink/30">
      <div className="flex items-center gap-2">
        <Eyebrow className={readyToRun ? "text-primary-ink" : undefined}>
          {readyToRun ? "Ready to run" : "Get set up"}
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

      {readyToRun ? (
        /* The payoff — the only state where the yellow button is the run itself. */
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            You’re ready — log your first run
          </h2>
          <ButtonLink href="/runs/new" className="mt-3 w-full gap-1.5 px-4 py-3 text-sm">
            Log your first run
            <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
          </ButtonLink>

          {!hasSetup ? (
            <>
              <p className="mt-4 micro-caps text-muted-foreground">
                Make it better
              </p>
              <div className="mt-2 flex flex-col gap-2">{setupRow}</div>
            </>
          ) : null}
        </>
      ) : hasCar ? (
        /* Car in, timing outstanding. Timing is where the yellow button goes: without
           it lap times never find the driver, which is the one job the app exists to
           do. The sheet sits under it, labelled as what it is.

           The button says "Continue setting up", not the name of the step (founder
           2026-08-18): naming the step made it read as a second chore being demanded
           after the car, when what it actually is is the rest of the same one. The
           sentence above it already says what happens next, so the button only has to
           carry the momentum. */
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            Car’s in — one thing left
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            Your name and transponder, so lap times attach to you on their own instead of being
            typed in by hand.
          </p>
          <ButtonLink href="/settings" className="mt-3 w-full gap-1.5 px-4 py-3 text-sm">
            Continue setting up
            <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
          </ButtonLink>

          {!hasSetup ? (
            <>
              <p className="mt-4 micro-caps text-muted-foreground">Optional</p>
              <div className="mt-2 flex flex-col gap-2">{setupRow}</div>
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
