"use client";

import { Capacitor } from "@capacitor/core";

/**
 * Apple/Google sign-in inside the iPhone app, through the phone's own sheets
 * (`@capgo/capacitor-social-login`, build 2 onward). Google no longer detours through Safari —
 * the reason the app was email-only until 2026-09-25.
 *
 * The flow: fetch a nonce (a cookie on this app) → the native sheet signs in and writes the nonce
 * into its token → post the token to `/api/auth/social/native` → go where it says (the sign-in
 * itself, or "new or existing?"). The server checks everything; this file only carries it.
 */

export type NativeSocialConfig = {
  apple: boolean;
  google: { iosClientId: string; serverClientId: string } | null;
};

export type NativeSocialResult = { next: string } | { cancelled: true };

/** True only in an app build that carries the plugin; build 1 doesn't, and keeps email only. */
export function nativeSocialAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("SocialLogin");
}

/**
 * The plugin comes back inside an object, never bare: a Capacitor plugin is a Proxy that answers
 * every property, `then` included, so returning it from an async function hangs the await (the
 * same trap that stuck notifications on "Enabling…", see `nativePushClient.ts`).
 */
async function loadPlugin() {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  return { SocialLogin };
}

let initializedFor: string | null = null;

async function ensureInitialized(config: NativeSocialConfig): Promise<void> {
  const key = JSON.stringify(config);
  if (initializedFor === key) return;
  const { SocialLogin } = await loadPlugin();
  await SocialLogin.initialize({
    // The client id is not used by iOS itself; the plugin needs one to switch Apple on.
    // `useProperTokenExchange` hands back the one-time code the server trades for the token that
    // Delete account later uses to disconnect Apple.
    ...(config.apple ? { apple: { clientId: "com.rcengineer.app", useProperTokenExchange: true } } : {}),
    ...(config.google
      ? {
          google: {
            iOSClientId: config.google.iosClientId,
            // Tokens then name the website's Google client too, which the server already trusts.
            iOSServerClientId: config.google.serverClientId,
            mode: "online" as const,
          },
        }
      : {}),
  });
  initializedFor = key;
}

/** Apple's "canceled" (1001) and Google's "user canceled" both mean: back to the form, no error. */
function isCancel(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /cancel|1001/i.test(message);
}

export async function nativeSocialSignIn(
  provider: "apple" | "google",
  config: NativeSocialConfig,
  callbackPath: string,
): Promise<NativeSocialResult> {
  await ensureInitialized(config);
  const { SocialLogin } = await loadPlugin();

  const nonceRes = await fetch("/api/auth/social/nonce", { method: "POST" });
  const { nonce } = (await nonceRes.json().catch(() => ({}))) as { nonce?: string };
  if (!nonceRes.ok || !nonce) throw new Error("Could not reach the server. Please try again.");

  let payload: Record<string, unknown>;
  try {
    if (provider === "apple") {
      const { result } = await SocialLogin.login({ provider: "apple", options: { nonce } });
      payload = {
        provider,
        idToken: result.idToken,
        authorizationCode: result.authorizationCode ?? null,
        givenName: result.profile?.givenName ?? null,
        familyName: result.profile?.familyName ?? null,
      };
    } else {
      const { result } = await SocialLogin.login({ provider: "google", options: { nonce } });
      if (result.responseType !== "online") throw new Error("Google sign-in didn't finish.");
      payload = { provider, idToken: result.idToken };
    }
  } catch (err) {
    if (isCancel(err)) return { cancelled: true };
    throw err instanceof Error ? err : new Error("That sign-in didn't go through. Please try again.");
  }

  const res = await fetch("/api/auth/social/native", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, callbackPath }),
  });
  const data = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
  if (!res.ok || !data.next) {
    throw new Error(data.error ?? "That sign-in didn't go through. Please try again.");
  }
  return { next: data.next };
}
