/**
 * The parts of the sign-in code both sides of the wire need. Kept free of `node:crypto` (and of
 * every other Node import) on purpose: the code box on `/login/verify-request` is a client
 * component, and importing the hashing module would drag `node:crypto` into the browser bundle.
 *
 * The hashing and the attempt rules live in `signInCodeLogic.ts`; the database in `signInCode.ts`.
 */

export const SIGN_IN_CODE_LENGTH = 6;

/** Short on purpose — the code is typed within a minute or two of asking, or not at all. */
export const SIGN_IN_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * Guesses allowed against one issued code before the row is destroyed. Five leaves 5-in-10^6 odds
 * for an attacker who already knows the target's email and has a request in flight — and the
 * counter is a DB column, not the in-memory limiter, because that limiter is per serverless
 * instance and would reset under any real attack.
 */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * What the user typed, reduced to digits — mail clients and humans add spaces and dashes, and
 * "123 456" pasted out of an email should just work. Returns null unless exactly six digits
 * survive, so a junk submission never reaches the database.
 */
export function normalizeCodeInput(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length === SIGN_IN_CODE_LENGTH ? digits : null;
}
