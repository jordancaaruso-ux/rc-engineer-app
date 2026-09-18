import { getCurrentPosition } from "@/lib/location/getCurrentPosition";

const sentThisPage = new Set<string>();

/**
 * Tell the server where the phone is, for a track a run was just saved at — only when location
 * permission is ALREADY granted, so it never raises a prompt, and once per track per page load.
 * Every failure is silent: this is a background contribution to the track's pin, not a feature
 * the driver sees. The rules for what the server keeps live in `trackPinRules.ts`.
 */
export async function sendTrackSighting(trackId: string): Promise<void> {
  if (sentThisPage.has(trackId)) return;
  try {
    if (typeof navigator === "undefined" || typeof navigator.permissions?.query !== "function") return;
    const status = await navigator.permissions.query({ name: "geolocation" });
    if (status.state !== "granted") return;
    sentThisPage.add(trackId);
    const position = await getCurrentPosition({ timeoutMs: 10_000, maximumAgeMs: 5 * 60_000 });
    await fetch(`/api/tracks/${encodeURIComponent(trackId)}/sighting`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(position),
      keepalive: true,
    });
  } catch {
    // Denied, unsupported (older WebKit / the Capacitor shell), no fix, offline — nothing to say.
  }
}
