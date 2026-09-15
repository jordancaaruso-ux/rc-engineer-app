/**
 * Who the sweep is allowed to act for. `SWEEP_LISTENER_EMAILS` (comma-separated, case-insensitive)
 * narrows listening to those accounts — the beta site shares production's database, so without
 * it the beta sweep would file runs and send pushes to every paying member. Unset = everyone who
 * is entitled (production after launch).
 */
export function parseSweepListenerAllowlist(raw: string | undefined | null): Set<string> | null {
  const text = raw?.trim();
  if (!text) return null;
  const emails = text
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  return new Set(emails);
}

export function isSweepListenerEmail(email: string | null | undefined, allow: Set<string> | null): boolean {
  if (allow === null) return true;
  const e = email?.trim().toLowerCase();
  return !!e && allow.has(e);
}

export function sweepListenerAllowlist(): Set<string> | null {
  return parseSweepListenerAllowlist(process.env.SWEEP_LISTENER_EMAILS);
}
