import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasDatabaseUrl } from "@/lib/env";
import { freshThrowawayAlias } from "@/lib/account/throwawayAccounts";
import { redirectSignedIn } from "@/lib/auth/devSessionCookie";

/**
 * Dev-only one-tap new user. GET this and you ARE a brand-new account: fresh `+ob…` alias, no car,
 * no runs, welcome overlay armed, sitting on the dashboard. Bookmark it on a phone and every load
 * starts another one — nothing to mint first, nothing single-use to burn, and it works from any
 * device on the LAN because the redirect is relative to the URL you loaded (see
 * `lib/auth/devSessionCookie.ts` for why that matters).
 *
 * Public by construction, exactly like `/api/auth/demo`: the middleware matcher excludes `api/auth`
 * entirely, and this static segment takes priority over the `[...nextauth]` catch-all. The 404 below
 * is therefore the ONLY thing keeping it out of production — treat it as load-bearing.
 *
 * Skipped versus a real sign-in: only the token exchange. The allowlist row, the `User` row, the
 * JWT shape and every onboarding gate downstream are identical. To exercise the magic-link leg
 * itself, use `npm run onboarding:new` and click the printed link on a desktop browser.
 *
 * Accounts pile up (one per load) — `npm run onboarding:cleanup` deletes every `+ob…` alias.
 */
export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json({ error: "No DATABASE_URL" }, { status: 503 });
  }

  const email = freshThrowawayAlias(randomBytes(2).toString("hex"), new Date());

  // Belt-and-braces beside the User row: `auth.ts`'s signIn callback rejects non-allowlisted
  // emails, so a later real sign-in on this alias (`onboarding:new -- --link`) still works.
  await prisma.authAllowedEmail.upsert({
    where: { email },
    create: { email },
    update: {},
    select: { id: true },
  });

  // What the Auth.js adapter would have created on a magic-link click: nothing but the user,
  // verified. No Account row — the Email provider does not write one.
  const user = await prisma.user.create({
    data: { email, emailVerified: new Date() },
    select: { id: true },
  });

  console.info(`[dev-new-user] signed in as ${email} (${user.id})`);

  return redirectSignedIn({ request, userId: user.id, email });
}
