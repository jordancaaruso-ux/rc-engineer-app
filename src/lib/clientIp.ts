/**
 * Best-effort client IP for per-IP rate-limit keys (Vercel sets x-forwarded-for). Extracted
 * from redeem-access-code so every public endpoint brakes on the same key shape. Best-effort
 * only — spoofable outside a trusted proxy and "unknown" when absent; callers must treat it
 * as a brake, not an identity.
 */
export function clientIpKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || request.headers.get("x-real-ip")?.trim() || "unknown";
}
