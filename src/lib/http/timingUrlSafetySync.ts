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
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (isIpv4Literal(hostname) || hostname.includes(":")) return isBlockedIp(hostname);
  return false;
}

export function isTimingHostnameAllowed(hostname: string, allowAnyPublicHost: boolean): boolean {
  return hostnameAllowed(hostname, allowAnyPublicHost);
}
