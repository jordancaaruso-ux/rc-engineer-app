import { timingSafeEqual } from "node:crypto";
import { normalizeCodeInput } from "@/lib/auth/signInCodeShared";

/**
 * The App Store reviewer's way in (guideline 2.1: a submission must include a working demo
 * account). Sign-in here is a code sent by email, and Apple's reviewer has no inbox we can reach,
 * so ONE address set on Vercel signs in with ONE fixed code set beside it:
 *
 *   APP_REVIEW_EMAIL=<the address given to Apple>
 *   APP_REVIEW_CODE=<six digits>
 *
 * Neither value lives in this repo, because the repo is public. Unset either one and all of this
 * switches off.
 *
 * The address also gets full access by itself, the way an admin does (`isGrandfatheredEmail`).
 * Reviewers test Delete account, and a comped Stripe plan dies with the deleted user row: without
 * this, the next reviewer to sign in would land on an account with no plan and nothing to review.
 */

function reviewerEmail(): string | null {
  const raw = process.env.APP_REVIEW_EMAIL?.trim().toLowerCase();
  return raw && raw.includes("@") && !/\s/.test(raw) ? raw : null;
}

function reviewerCode(): string | null {
  return normalizeCodeInput(process.env.APP_REVIEW_CODE?.trim());
}

/** Is this the App Store reviewer's address? False for everyone unless BOTH variables are set. */
export function isAppReviewerEmail(email: string | null | undefined): boolean {
  const reviewer = reviewerEmail();
  if (!reviewer || !reviewerCode()) return false;
  return email?.trim().toLowerCase() === reviewer;
}

/**
 * Does this email + code pair open the reviewer's account? `code` is the already-normalized six
 * digits. Compared in constant time; the IP and per-address brakes in the calling route still apply.
 */
export function isAppReviewerCode(email: string, code: string): boolean {
  const expected = reviewerCode();
  if (!expected || !isAppReviewerEmail(email)) return false;
  const given = Buffer.from(code);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
