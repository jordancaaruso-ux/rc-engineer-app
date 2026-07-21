"use client";

import { Capacitor } from "@capacitor/core";

/**
 * Native (APNs) push helpers for the Capacitor shell.
 *
 * Why this exists alongside `webPush/pushClient.ts`: the Push API is not exposed to
 * WKWebView, so the web-push flow (service worker + `PushManager`) cannot run inside
 * the native app. Safari's home-screen PWA still uses that path; the shell uses this one.
 *
 * The APNs token arrives via the `registration` event rather than from `register()`,
 * so the register call is promise-wrapped here.
 */

/** True only inside the Capacitor shell (false on web + home-screen PWA). */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function loadPlugin() {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return PushNotifications;
}

const REGISTRATION_TIMEOUT_MS = 15_000;

/**
 * Register with APNs and resolve the device token. Assumes permission is already
 * granted — callers that need the prompt should use `enableNativePush`.
 */
async function registerForToken(): Promise<string> {
  const PushNotifications = await loadPlugin();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const cleanup = () => {
      clearTimeout(timer);
      for (const h of handles) void h.remove();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out waiting for the device token."));
    }, REGISTRATION_TIMEOUT_MS);

    void (async () => {
      handles.push(
        await PushNotifications.addListener("registration", (token) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(token.value);
        }),
      );
      handles.push(
        await PushNotifications.addListener("registrationError", (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(err?.error ?? "APNs registration failed."));
        }),
      );

      // Resolves immediately — the token comes back on the `registration` event above.
      await PushNotifications.register();
    })().catch((e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
}

/**
 * Cached so "turn off" can name the device: `PushNotifications.unregister()` discards
 * the token, leaving no way to identify which row to delete.
 */
const TOKEN_CACHE_KEY = "jrc.nativePushToken";

function cacheToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_CACHE_KEY, token);
    else window.localStorage.removeItem(TOKEN_CACHE_KEY);
  } catch {
    /* private mode / storage disabled — unregister falls back to a no-op */
  }
}

function cachedToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_CACHE_KEY);
  } catch {
    return null;
  }
}

async function persistToken(token: string): Promise<void> {
  const res = await fetch("/api/push/native/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      platform: Capacitor.getPlatform(),
      deviceLabel: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  cacheToken(token);
}

/** Current permission state without prompting. */
export async function nativePushPermission(): Promise<"granted" | "denied" | "prompt"> {
  const PushNotifications = await loadPlugin();
  const { receive } = await PushNotifications.checkPermissions();
  return receive === "granted" ? "granted" : receive === "denied" ? "denied" : "prompt";
}

/**
 * Prompt (if needed), register with APNs, and persist the token. Returns false when
 * the user declined — callers should surface that rather than retrying.
 */
export async function enableNativePush(): Promise<boolean> {
  const PushNotifications = await loadPlugin();
  const { receive } = await PushNotifications.requestPermissions();
  if (receive !== "granted") return false;

  const token = await registerForToken();
  await persistToken(token);
  return true;
}

/**
 * Re-send the current token without prompting. APNs tokens rotate (restore from
 * backup, reinstall), so this runs on launch when permission is already granted.
 */
export async function refreshNativePushToken(): Promise<void> {
  if ((await nativePushPermission()) !== "granted") return;
  const token = await registerForToken();
  await persistToken(token);
}

/** Forget this device server-side. The OS-level permission is left untouched. */
export async function disableNativePush(): Promise<void> {
  const PushNotifications = await loadPlugin();
  const token = cachedToken();

  await PushNotifications.unregister().catch(() => {});

  if (token) {
    await fetch("/api/push/native/unregister", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }
  cacheToken(null);
}

/** True when this device has a token registered (drives the settings toggle state). */
export function hasRegisteredNativePush(): boolean {
  return Boolean(cachedToken());
}
