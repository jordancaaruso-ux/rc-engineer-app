"use client";

import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";

/**
 * Seed the provider with the server-resolved session so `useSession()` consumers
 * (e.g. the top-right account avatar) render from the correct data on first paint
 * instead of flashing a loading state until the client fetches `/api/auth/session`.
 * Without this, the corner avatar intermittently fell back to initials on cold
 * loads / PWA relaunches even though the image was stored.
 */
export function AuthSessionProvider({
  children,
  session,
}: {
  children: ReactNode;
  session: Session | null;
}): ReactNode {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
