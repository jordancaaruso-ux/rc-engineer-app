import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Shared signup access code — the gate that lets someone add themselves to the allowlist
 * without the founder in the loop, while keeping the app undiscoverable to passers-by.
 *
 * `SIGNUP_ACCESS_CODE` holds one or more comma/whitespace-separated codes so a different one
 * can go to each club and be revoked individually (rotate the env value; already-redeemed
 * `AuthAllowedEmail` rows survive — that's the point).
 *
 * Codes must be high entropy (e.g. `jrc-9f3a2c7e41`). Entropy, not the best-effort in-memory
 * rate limiter, is the real brute-force defence — the limiter is per serverless instance.
 */

/** Comma- or whitespace-separated code list from env (case-insensitive, trimmed). */
export function parseSignupAccessCodes(raw: string | undefined): Set<string> {
  const trimmed = raw?.trim();
  if (!trimmed) return new Set();
  return new Set(
    trimmed
      .split(/[,\s]+/)
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean)
  );
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time compare over fixed-width digests (raw lengths differ, so hash first). */
function codesMatch(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/**
 * Pure check against an explicit code list — the testable core.
 * Returns false when no codes are configured: an unset env must never open the door.
 */
export function matchesSignupAccessCode(
  candidate: string | null | undefined,
  configured: Set<string>
): boolean {
  const normalized = candidate?.trim().toLowerCase();
  if (!normalized || configured.size === 0) return false;
  let matched = false;
  // Compare against every configured code (no early exit) so timing doesn't leak which
  // code matched or how many are configured.
  for (const code of configured) {
    if (codesMatch(normalized, code)) matched = true;
  }
  return matched;
}

export function isSignupAccessCodeConfigured(): boolean {
  return parseSignupAccessCodes(process.env.SIGNUP_ACCESS_CODE).size > 0;
}

export function verifySignupAccessCode(candidate: string | null | undefined): boolean {
  return matchesSignupAccessCode(
    candidate,
    parseSignupAccessCodes(process.env.SIGNUP_ACCESS_CODE)
  );
}
