import dns from "node:dns/promises";
import net from "node:net";

/** Known public timing hosts (hostname suffix match). */
const TIMING_HOST_SUFFIXES = [
  "liverc.com",
  "live-rc.com",
  "rcprotiming.com",
  "mylaps.com",
  "rctrack.info",
];

function hostnameAllowed(hostname: string, allowAnyPublicHost: boolean): boolean {
  const h = hostname.toLowerCase();
  if (TIMING_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`))) {
    return true;
  }
  return allowAnyPublicHost;
}

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
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (net.isIP(hostname)) return isBlockedIp(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((r) => isBlockedIp(r.address));
  } catch {
    return true;
  }
}

export type ValidateTimingUrlOptions = {
  /** Admin bypass: allow any public http(s) host (private IPs still blocked). */
  allowAnyPublicHost?: boolean;
};

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
  if (!hostnameAllowed(u.hostname, allowAny)) {
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

/** Sync check for protocol/hostname only (use async for DNS when fetching). */
export function validateTimingHttpUrlSync(
  url: string,
  options: ValidateTimingUrlOptions = {}
): { ok: true; normalized: string } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) return { ok: false, error: "url is required" };
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return { ok: false, error: "URL must be http(s)" };
    }
    if (u.username || u.password) {
      return { ok: false, error: "URL must not include credentials" };
    }
    if (!hostnameAllowed(u.hostname, options.allowAnyPublicHost === true)) {
      return { ok: false, error: "URL host not in allowed timing domains" };
    }
    if (u.hostname === "localhost" || net.isIP(u.hostname) && isBlockedIp(u.hostname)) {
      return { ok: false, error: "URL host not permitted" };
    }
    return { ok: true, normalized: trimmed };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}
