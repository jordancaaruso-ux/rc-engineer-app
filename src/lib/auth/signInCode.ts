import "server-only";

import { prisma } from "@/lib/prisma";
import {
  evaluateCodeAttempt,
  generateSignInCode,
  hashSignInCode,
} from "@/lib/auth/signInCodeLogic";
import { SIGN_IN_CODE_TTL_MS } from "@/lib/auth/signInCodeShared";

/**
 * Database side of the emailed sign-in code. The rules live in `signInCodeLogic.ts`; this file
 * only moves rows.
 *
 * The attempt cap is enforced HERE, in a column, and never by `checkApiRateLimit` — that limiter
 * is an in-memory map per serverless instance, and both it and its callers say outright that it
 * is a brake, not a defence. It resets whenever a new lambda spins up, so a six-digit code
 * guarded only by it would be walkable. The row-level counter survives everything.
 *
 * For the same reason the code is NEVER written into `VerificationToken`. If it were, guesses
 * could be fired straight at `/api/auth/callback/nodemailer`, which is public, unthrottled, and
 * not interceptable — the middleware matcher excludes `api/auth` wholesale. Forcing every guess
 * through `/api/auth/verify-code` is what makes six digits safe.
 */

function authSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set — cannot issue a sign-in code");
  return secret;
}

/**
 * Mint the code that goes in the email. Any earlier code for this address is dropped first:
 * asking for a new sign-in must invalidate the old one, or a stale email stays live for its full
 * TTL. Expired rows anywhere are swept on the way past — cheap, indexed, and it saves owning a
 * cron for a table that only ever holds in-flight sign-ins.
 *
 * Callers must run this AFTER the allowlist gate, so a declined address never gets a live code.
 */
export async function issueSignInCode(email: string): Promise<string> {
  const identifier = email.trim().toLowerCase();
  const code = generateSignInCode();
  const now = new Date();

  await prisma.signInCode.deleteMany({
    where: { OR: [{ identifier }, { expires: { lt: now } }] },
  });
  await prisma.signInCode.create({
    data: {
      identifier,
      codeHash: hashSignInCode(code, authSecret()),
      expires: new Date(now.getTime() + SIGN_IN_CODE_TTL_MS),
    },
  });

  return code;
}

/**
 * Check one typed code and consume it on success. Returns a bare boolean on purpose: the caller
 * must not be able to tell "no code pending for this address" from "wrong code" from "used up",
 * or the endpoint becomes an oracle for whether someone is mid-sign-in.
 */
export async function consumeSignInCode(email: string, code: string): Promise<boolean> {
  const identifier = email.trim().toLowerCase();
  const row = await prisma.signInCode.findFirst({
    where: { identifier },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expires: true, attempts: true },
  });
  if (!row) return false;

  // Count the guess BEFORE judging it. A crash between the two must cost the attacker an attempt,
  // never hand them a free one.
  const counted = await prisma.signInCode.update({
    where: { id: row.id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });

  const { ok, burn } = evaluateCodeAttempt({
    code,
    storedHash: row.codeHash,
    expires: row.expires,
    attemptsAfterIncrement: counted.attempts,
    secret: authSecret(),
    now: new Date(),
  });

  if (burn) {
    await prisma.signInCode.deleteMany({ where: { id: row.id } });
  }
  return ok;
}
