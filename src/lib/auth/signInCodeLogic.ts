import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { MAX_CODE_ATTEMPTS, SIGN_IN_CODE_LENGTH } from "@/lib/auth/signInCodeShared";

/**
 * The pure core of the emailed sign-in code — no Prisma, no env, so a plain `tsx` test can
 * import it (same split as `billing/paidSignupLogic.ts`). The database side lives in
 * `signInCode.ts`; the constants a client component also needs are in `signInCodeShared.ts`,
 * kept separate so `node:crypto` never reaches the browser bundle.
 *
 * WHY A CODE EXISTS AT ALL: a magic link is a *browser action* and lands wherever the OS decides
 * to open it. On iOS, Mail opens the default browser — so a driver who asked for the link in
 * Safari gets signed into Chrome instead, and Safari can never see that cookie (separate jars).
 * A code is *information*: the human carries it back across the gap. The same fix covers reading
 * the mail on another device, the Capacitor webview's third cookie jar, and corporate mail
 * scanners that pre-click links and burn the single-use token before anyone sees it.
 *
 * SIX DIGITS IS ONLY 10^6. That is not enough entropy on its own, so unlike the signup access
 * code (`signupAccessCode.ts`, where entropy IS the defence) this one leans on a hard attempt cap
 * stored on the row. Numeric on purpose: it brings up the phone keypad, and it lets iOS offer the
 * code above the keyboard straight from Mail.
 */

/** Cryptographically random, leading zeros kept — "004217" is a valid code. */
export function generateSignInCode(): string {
  return String(randomInt(0, 10 ** SIGN_IN_CODE_LENGTH)).padStart(SIGN_IN_CODE_LENGTH, "0");
}

/**
 * Same construction as the magic-link token (`mintMagicLinkUrl.ts`): SHA-256 over code + secret.
 * The plaintext code exists only in the email — a DB dump alone can't be replayed without the
 * app secret.
 */
export function hashSignInCode(code: string, secret: string): string {
  return createHash("sha256").update(`${code}${secret}`).digest("hex");
}

/** Constant-time compare over fixed-width digests, so timing can't leak a partial match. */
export function codeMatchesHash(code: string, storedHash: string, secret: string): boolean {
  const candidate = Buffer.from(hashSignInCode(code, secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  // A malformed stored hash would make timingSafeEqual throw on length mismatch.
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

/**
 * Decide the fate of one guess against a stored row. Pure so the exhaustion rule is testable
 * without a database: the caller has already incremented `attempts`, and this says both whether
 * the guess was right and whether the row survives.
 */
export function evaluateCodeAttempt(input: {
  code: string;
  storedHash: string;
  expires: Date;
  attemptsAfterIncrement: number;
  secret: string;
  now: Date;
}): { ok: boolean; burn: boolean } {
  if (input.expires.getTime() <= input.now.getTime()) return { ok: false, burn: true };
  if (input.attemptsAfterIncrement > MAX_CODE_ATTEMPTS) return { ok: false, burn: true };
  if (codeMatchesHash(input.code, input.storedHash, input.secret)) return { ok: true, burn: true };
  // Wrong but not yet exhausted — keep the row so one fat-fingered digit isn't a dead end.
  return { ok: false, burn: input.attemptsAfterIncrement >= MAX_CODE_ATTEMPTS };
}
