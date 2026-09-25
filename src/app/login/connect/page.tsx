import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { DoorScene } from "@/components/brand/DoorScene";
import { JrcMark } from "@/components/brand/JrcMark";
import { readPendingLink } from "@/lib/auth/social/pendingLink";
import { isNativeShellRequest } from "@/lib/nativeShellServer";
import { ConnectChoice } from "./ConnectChoice";

export const metadata = { title: "New to Trackside?" };

/**
 * An Apple/Google sign-in that matched no account lands here instead of making one (founder,
 * 2026-09-25: nobody ends up with two accounts). The driver says which it is:
 *
 *  - new → in the app, the account is made (unpaid, like the app's email sign-up); on the website,
 *    the way in is the plans, same as ever;
 *  - already have an account → sign in to it once, and this Apple/Google is linked to it.
 *
 * The identity waits in an encrypted cookie set by the sign-in (`lib/auth/social/pendingLink.ts`);
 * without it there is nothing to decide, so back to the sign-in page.
 */
export default async function ConnectPage(): Promise<ReactNode> {
  const pending = await readPendingLink();
  if (!pending?.email) redirect("/login");
  const inApp = await isNativeShellRequest();

  return (
    <div className="door-dark relative flex min-h-[100dvh] w-full flex-1 flex-col items-center justify-center overflow-hidden bg-background px-5 py-12">
      <DoorScene variant="focus" />
      <div className="relative z-10 w-full max-w-[400px]">
        <div className="flex justify-center">
          <JrcMark variant="yellow" priority className="h-10" />
        </div>
        <div className="door-sheet login-sheen mt-8 p-6">
          <h1 className="page-title text-center">New to Trackside?</h1>
          <ConnectChoice
            provider={pending.provider}
            email={pending.email}
            emailHidden={pending.isPrivateEmail}
            inApp={inApp}
          />
        </div>
      </div>
    </div>
  );
}
