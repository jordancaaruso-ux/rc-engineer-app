import "server-only";

import dns from "node:dns/promises";
import net from "node:net";
import {
  isTimingHostnameAllowed,
  isTimingHostnameBlocked,
  validateTimingHttpUrlSync,
  type ValidateTimingUrlOptions,
} from "@/lib/http/timingUrlSafetySync";

export type { ValidateTimingUrlOptions } from "@/lib/http/timingUrlSafetySync";
export { validateTimingHttpUrlSync } from "@/lib/http/timingUrlSafetySync";

function isBlockedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
  }
  return false;
}

async function resolveHostBlocked(hostname: string): Promise<boolean> {
  if (isTimingHostnameBlocked(hostname)) return true;
  if (net.isIP(hostname)) return isBlockedIp(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((r) => isBlockedIp(r.address));
  } catch {
    return true;
  }
}

export async function validateTimingHttpUrlAsync(
  url: string,
  options: ValidateTimingUrlOptions = {}
): Promise<{ ok: true; normalized: string } | { ok: false; error: string }> {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "url is required" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "URL must be http(s)" };
  }
  if (u.username || u.password) {
    return { ok: false, error: "URL must not include credentials" };
  }
  const allowAny = options.allowAnyPublicHost === true;
  if (!isTimingHostnameAllowed(u.hostname, allowAny)) {
    return {
      ok: false,
      error: allowAny
        ? "URL host not permitted"
        : "URL host not in allowed timing domains (LiveRC, etc.)",
    };
  }
  if (await resolveHostBlocked(u.hostname)) {
    return { ok: false, error: "URL resolves to a blocked address" };
  }
  return { ok: true, normalized: trimmed };
}
