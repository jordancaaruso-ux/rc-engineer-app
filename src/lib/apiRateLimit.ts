import "server-only";

import { NextResponse } from "next/server";
import { isAuthAdminEmail } from "@/lib/authAdmin";

type Bucket = { count: number; windowStartMs: number };

const buckets = new Map<string, Bucket>();

/** In-memory sliding window (best-effort on serverless; still curbs abuse). */
export function checkApiRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  userEmail?: string | null;
}): { ok: true } | { ok: false; retryAfterSec: number } {
  if (isAuthAdminEmail(input.userEmail)) return { ok: true };

  const now = Date.now();
  const bucket = buckets.get(input.key);
  if (!bucket || now - bucket.windowStartMs >= input.windowMs) {
    buckets.set(input.key, { count: 1, windowStartMs: now });
    return { ok: true };
  }
  if (bucket.count >= input.limit) {
    const retryAfterSec = Math.ceil((input.windowMs - (now - bucket.windowStartMs)) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
  }
  bucket.count += 1;
  return { ok: true };
}

export function rateLimitResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
  );
}
