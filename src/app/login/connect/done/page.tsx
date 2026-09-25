import type { ReactNode } from "react";
import Link from "next/link";

import { DoorScene } from "@/components/brand/DoorScene";
import { JrcMark } from "@/components/brand/JrcMark";
import { primaryButtonClassName } from "@/components/ui/ButtonLink";
import { providerLabel } from "@/lib/auth/social/socialSignInLogic";

export const metadata = { title: "Connected" };

/**
 * After "I already have an account": says the link happened, so the driver knows next time is one
 * tap. `taken=1` when that Apple/Google already opens a different Trackside account — it stays
 * there, and this account is signed in without it.
 */
export default async function ConnectDonePage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; taken?: string }>;
}): Promise<ReactNode> {
  const params = await searchParams;
  const label = providerLabel(params.provider === "google" ? "google" : "apple");
  const taken = params.taken === "1";

  return (
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      <DoorScene variant="focus" />
      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex justify-center">
          <JrcMark variant="yellow" priority className="h-10" />
        </div>
        <div className="door-sheet login-sheen mt-8 p-6 text-center">
          <h1 className="page-title">{taken ? "Not connected" : `${label} connected`}</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {taken
              ? `That ${label} account already opens a different Trackside account.`
              : `Next time, tap Continue with ${label}.`}
          </p>
          <Link
            href="/"
            className={primaryButtonClassName(
              "primary-action-chip-prominent mt-6 w-full px-4 py-3 text-[13px] uppercase tracking-[0.14em]"
            )}
          >
            Continue
          </Link>
        </div>
      </div>
    </div>
  );
}
