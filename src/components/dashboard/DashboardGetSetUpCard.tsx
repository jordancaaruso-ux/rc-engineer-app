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
 * amended 2026-08-18 and 2026-08-26).
 *
 * The single first-run surface that replaced the guide chip + resume/payoff cards.
 * Every row navigates — no dead taps; all state is derived, so the card self-retires
 * once the walk is finished, a run exists, or Ignore is tapped.
 *
 * **The walk is CAR → TIMING → SETUP, three steps of equal weight** (founder
 * 2026-08-26). The sheet used to ride along under an "Optional" / "Make it better"
 * heading, which is exactly how it read: a nice-to-have. It is not — without one a
 * run is a lap time with no car behind it, and the Engineer can only answer in
 * general. So the label is gone and the sheet is step three.
 *
 * It still does not GATE anything, and that is the 2026-08-18 call standing: the
 * sheet is the one item needing something the driver may not have on them (the
 * manufacturer's fillable PDF), and on an uncalibrated chassis it is minutes of
 * typing rather than a 30-second upload. So step three has two doors — add it now,
 * or add it when you log a run, which is true: the wizard's setup step carries the
 * same upload plus write-from-scratch. Somebody standing at the track is never held up.
 *
 * **No "Log your first run" button** (founder 2026-08-26). The card used to end on
 * "You're ready — log your first run" with a yellow button, sitting directly beneath
 * the dashboard's yellow Start-a-run bar — two yellow buttons, one job. The bar is
 * the run door and always was, so the card's last state is now the sheet ask and
 * nothing else. Once all three are done the card retires (`showGetSetUpCard`) rather
 * than hanging around with three ticks and no purpose.
 *
 * The Setup action delegates entirely to `UploadSetupSheetBar`, which already
 * branches per car: a green-lit chassis opens the photo/PDF/paste doors, everything
 * else routes to the hand-build create-a-setup flow — so the "quick upload vs.
 * slower build" adaptivity lives in one place, not here.
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

  const canUpload = setupCars.some((c) => c.supportsUpload);
  const setupMeta = hasSetup
    ? "The Engineer can read your actual car"
    : !hasCar
      ? "Add a car first"
      : canUpload
        ? "Upload your sheet — the fillable PDF, about 30 seconds"
        : "Build it in the app — a few minutes";

  /**
   * The sheet step's own body. Live once there is a car and no sheet yet; otherwise a
   * plain (done, or waiting-on-the-car) row. It is a step, never a footnote — the
   * micro-caps "Optional" / "Make it better" heading that used to sit above it is gone.
   */
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

  /**
   * The deferral door — the reason the sheet can be step three without gating anything.
   * Deliberately quiet text and not a second yellow button: the dashboard's Start-a-run
   * bar sits directly above this card, and the loud run button that used to live here is
   * exactly what came out on 2026-08-26. What it promises is real — the wizard's setup
   * step offers the same upload.
   */
  const laterDoor = (
    <Link
      href="/runs/new"
      className="mt-2.5 block text-[12px] font-semibold text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-foreground"
    >
      Or add it when you log a run — the run form asks for it
    </Link>
  );

  const onSheetStep = hasCar && hasTimingIdentity;

  return (
    <CardPanel className="border-primary-ink/30">
      <div className="flex items-center gap-2">
        <Eyebrow className={onSheetStep ? "text-primary-ink" : undefined}>
          {onSheetStep ? "Last step" : "Get set up"}
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

      {onSheetStep ? (
        /* Car and timing in, sheet outstanding — the card IS the sheet ask now. No
           checklist rows here: with two of the three ticked and the third spelled out
           underneath, the rows would only repeat what the heading already says. */
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            Add your setup sheet
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
            {canUpload
              ? "This is what lets the Engineer talk about your actual car — your springs, droop and camber — instead of answering in general."
              : "Your chassis has no readable sheet yet, so this one gets built in the app. It is what lets the Engineer talk about your actual car instead of answering in general."}
          </p>
          <div className="mt-3">
            {setupCars.length > 0 ? <UploadSetupSheetBar cars={setupCars} /> : null}
            {laterDoor}
          </div>
        </>
      ) : hasCar ? (
        /* Car in, timing outstanding. Timing is where the yellow button goes: without
           it lap times never find the driver, which is the one job the app exists to
           do. The sheet sits under it as what comes next, not as an aside.

           The button says "Continue setting up", not the name of the step (founder
           2026-08-18): naming the step made it read as a second chore being demanded
           after the car, when what it actually is is the rest of the same one. The
           sentence above it already says what happens next, so the button only has to
           carry the momentum. It is also the exact wording the car page now hands back
           with, so finding it again on landing reads as one journey, not two asks.

           The headline is the ASK and nothing else (founder 2026-08-26, in two passes).
           It read "Car's in — timing next", which put the finished step first, so the eye
           landed on the thing already done; then "Timing next — car's in", which still
           spent half a headline congratulating them. The car is acknowledged by the car
           page's own confirmation and by nothing here. All three states now name the step
           the same way — "Add your car…", "Add your timing details", "Add your setup
           sheet" — which is also how the rows read. */
        <>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground">
            Add your timing details
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
              <p className="mt-4 micro-caps text-muted-foreground">After that</p>
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
            Runs attach to a car — it’s the one thing we can’t guess. Then your timing details and
            your setup sheet, and the app knows what it’s looking at.
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
