import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { DoorScene } from "@/components/brand/DoorScene";
import { JrcMark } from "@/components/brand/JrcMark";
import { requireCurrentUserAllowUnpaid } from "@/lib/currentUser";
import { getEntitlement } from "@/lib/entitlement";
import { prisma } from "@/lib/prisma";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import { isDemoIdentity } from "@/lib/demo/demoAccess";
import { sendAppWelcomeEmailOnce } from "@/lib/auth/sendAppWelcomeEmail";
import { RefreshWhenBack, SignedUpFooter, TryDemoButton } from "./SignedUpClient";

export const metadata = { title: "You're signed up" };

/**
 * Where an account made by the app's sign-up waits until it has a plan (2026-09-24). Inside the
 * app nothing may be sold or pointed at (App Store guideline 3.1.3), so this screen names no plan,
 * price or website: it says an email went out, and the welcome email it sends — once per
 * account, the first time it is reached — carries the plans instead.
 *
 * Reached from the paywall: `requireCurrentUser` sends an unpaid account to /billing, and
 * /billing sends a never-subscribed account in the app here. It lives under /login so it has the
 * signed-out family's scene and no app chrome.
 */
export default async function SignedUpPage(): Promise<ReactNode> {
  const user = await requireCurrentUserAllowUnpaid();
  const [entitlement, subscription] = await Promise.all([
    getEntitlement(user),
    prisma.subscription.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);
  // A plan, or a plan that lapsed (the app's plan notice handles that), belongs in the app. So
  // does the demo account, which is never "signed up".
  if (entitlement.entitled || subscription || isDemoIdentity({ id: user.id, email: user.email })) {
    redirect("/");
  }
  // On the website an unpaid account chooses a plan on /billing, where prices may be shown.
  if (!(await isNativeShellRequest())) redirect("/billing");

  const email = user.email ?? "";
  if (email) {
    after(() =>
      sendAppWelcomeEmailOnce({ id: user.id, email }).catch((err) =>
        console.error("[app-welcome] send failed", err)
      )
    );
  }

  return (
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      <DoorScene variant="focus" />
      <RefreshWhenBack />

      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex justify-center">
          <JrcMark variant="yellow" priority className="h-10" />
        </div>

        <div className="door-sheet login-sheen mt-8 p-6">
          <h1 className="page-title text-center">You&rsquo;re signed up</h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
            We&rsquo;ve emailed the next step
            {email ? (
              <>
                {" "}
                to <span className="text-foreground">{email}</span>
              </>
            ) : null}
            .
          </p>
          <TryDemoButton />
        </div>

        <SignedUpFooter />
      </div>
    </div>
  );
}
