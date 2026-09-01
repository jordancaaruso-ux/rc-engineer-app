/**
 * Known public timing hosts (hostname suffix match).
 *
 * `myrcm.ch` was taken off this list on 2026-08-26 and moved to the denylist below — MyRCM
 * publishes no API and its operator has stated that reading its pages is not permitted, so the
 * only way in was HTML scraping. Every import and discovery fetch passes through here, which is
 * why this file, not the parser registry, is where a source is actually turned off. LiveRC and
 * MyLaps/Speedhive stay. The MyRCM parser modules (`lapUrlParsers/myRcm*.ts`) are left in the
 * tree, dormant and unreachable, so already imported MyRCM runs keep rendering and it is a
 * one-line job to restore if consent ever arrives.
 */
const TIMING_HOST_SUFFIXES = [
  "liverc.com",
  "live-rc.com",
  "rcprotiming.com",
  "mylaps.com",
  "rctrack.info",
];

/**
 * Hosts we will not fetch at all, whatever else says yes.
 *
 * Taking `myrcm.ch` off the allowlist above is not enough on its own: an admin request carries
 * `allowAnyPublicHost`, which waves through every public host, and `httpTimingParser` matches any
 * http(s) URL — so before this list existed an admin pasting a MyRCM report URL still fetched the
 * page and imported whatever decimals the generic HTML reader found on it. Measured on the dev
 * server 2026-08-26: it returned four "laps". A denylist that outranks the bypass is the only
 * version of this that actually holds.
 */
const BLOCKED_TIMING_HOST_SUFFIXES = ["myrcm.ch"];

function hostnameBlockedBySuffix(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return BLOCKED_TIMING_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`));
}

function hostnameAllowed(hostname: string, allowAnyPublicHost: boolean): boolean {
  const h = hostname.toLowerCase();
  if (hostnameBlockedBySuffix(h)) return false;
  if (TIMING_HOST_SUFFIXES.some((suffix) => h === suffix || h.endsWith(`.${suffix}`))) {
    return true;
  }
  return allowAnyPublicHost;
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedIp(ip: string): boolean {
  if (isIpv4Literal(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 127 || a === 0) return true;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  return false;
}

export type ValidateTimingUrlOptions = {
  /** Admin bypass: allow any public http(s) host (private IPs still blocked). */
  allowAnyPublicHost?: boolean;
};

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
    if (hostnameBlockedBySuffix(u.hostname)) {
      return { ok: false, error: "This timing site is not supported." };
    }
    if (!hostnameAllowed(u.hostname, options.allowAnyPublicHost === true)) {
      return { ok: false, error: "URL host not in allowed timing domains" };
    }
    if (u.hostname === "localhost" || isBlockedIp(u.hostname)) {
      return { ok: false, error: "URL host not permitted" };
    }
    return { ok: true, normalized: trimmed };
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
}

export function isTimingHostnameBlocked(hostname: string): boolean {
  if (hostnameBlockedBySuffix(hostname)) return true;
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (isIpv4Literal(hostname) || hostname.includes(":")) return isBlockedIp(hostname);
  return false;
}

export function isTimingHostnameAllowed(hostname: string, allowAnyPublicHost: boolean): boolean {
  return hostnameAllowed(hostname, allowAnyPublicHost);
}
