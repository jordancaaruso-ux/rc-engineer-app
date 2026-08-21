/**
 * A unique id for something that only exists in the browser (a form row, an upload slot).
 *
 * `crypto.randomUUID` is a secure-context API: it is simply not there on `http://192.168.x.x`,
 * which is exactly how this app is driven on a phone during development (see `allowedDevOrigins`
 * in next.config.mjs). Calling it directly threw a TypeError there, and every caller sat behind a
 * try/catch that reported it as "Request failed" — a network error for a bug that never touched the
 * network. Production is HTTPS and takes the first branch; the fallback is for the LAN.
 *
 * Not a UUID and not trying to be: nothing persists these, they only have to be distinct within one
 * page's lifetime.
 */
export function clientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
