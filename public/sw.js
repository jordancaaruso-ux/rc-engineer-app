/*
 * JRC Trackside service worker.
 *
 * Product name is a literal here on purpose: this file is served verbatim as a static asset
 * and is never bundled, so it cannot import PRODUCT_NAME from src/lib/brand/brandNames.ts.
 * Grep for the name when it changes.
 *
 * Scope: web push (notifications) + a MINIMAL offline shell. Deliberately does NOT
 * cache pages or API responses — only static brand assets + an offline fallback — so
 * there are no stale-data bugs. Registered prod-only (see ServiceWorkerRegistrar).
 */
// Bumped to v2 on 2026-08-18 with the "2c shaded" app icon: /icons/ is served
// cache-first, so an already-installed PWA would keep the old tile forever otherwise.
const VERSION = "v2";
const SHELL_CACHE = `jrc-shell-${VERSION}`;

// Static, safe-to-cache assets + the offline fallback page.
const SHELL_ASSETS = [
  "/offline.html",
  "/icons/icon-192.png",
  "/brand/jrc-mark-yellow.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("jrc-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never touch API / auth / data — always straight to network.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/_next/data")) return;

  // Navigations: network-first, fall back to the offline page when offline.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }

  // Static brand/icon/build assets: cache-first (immutable-ish), fill cache on miss.
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/_next/static/")
  ) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// --- Web push ---------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "JRC Trackside";
  const options = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/icon-192.png",
    tag: data.tag,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
