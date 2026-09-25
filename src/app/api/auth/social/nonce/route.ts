import { NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitResponse } from "@/lib/apiRateLimit";
import { clientIpKey } from "@/lib/clientIp";
import { issueSocialNonce } from "@/lib/auth/social/socialNonce";

/**
 * Step one of Apple/Google sign-in in the iPhone app: a fresh nonce for the native sign-in to
 * write into its token (`lib/auth/social/socialNonce.ts`). Public by construction: the middleware
 * matcher excludes `api/auth`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rl = checkApiRateLimit({
    key: `social-nonce:${clientIpKey(request)}`,
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
  return NextResponse.json({ nonce: await issueSocialNonce() });
}
