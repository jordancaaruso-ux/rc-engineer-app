import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { clearPendingLink, readPendingLink } from "@/lib/auth/social/pendingLink";
import { LinkedElsewhereError, linkIdentity } from "@/lib/auth/social/resolveSocialSignIn";

/**
 * The end of "I already have an account": the driver has just signed in to their account the usual
 * way (this path was the sign-in's callback), so link the Apple/Google identity waiting in the
 * pending cookie to it. From now on that Apple/Google opens this account directly.
 *
 * Needs both halves: the session proves the account is theirs, and the cookie (set only in the
 * browser that did the Apple/Google sign-in) proves the identity is. Public path under
 * `api/auth`; it checks the session itself.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url), 303);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return to("/login");

  const pending = await readPendingLink();
  if (!pending) return to("/");

  let taken = false;
  try {
    await linkIdentity(userId, pending, {
      refreshToken: pending.appleRefreshToken,
      clientId: pending.appleClientId,
    });
  } catch (err) {
    if (!(err instanceof LinkedElsewhereError)) throw err;
    taken = true;
  }
  await clearPendingLink();

  const params = new URLSearchParams({ provider: pending.provider });
  if (taken) params.set("taken", "1");
  return to(`/login/connect/done?${params}`);
}
