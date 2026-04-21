"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * When the app is opened via a custom URL or universal link, load the target in the WebView
 * so Auth.js callbacks can complete inside the same session as the shell.
 */
export function CapacitorDeepLinkBridge(): null {
  useEffect(() => {
    if (Capacitor.getPlatform() === "web") return;

    let remove: (() => void) | undefined;

    void (async () => {
      const { App } = await import("@capacitor/app");
      const handle = await App.addListener("appUrlOpen", ({ url }) => {
        try {
          const path = new URL(url).pathname + new URL(url).search;
          if (path.includes("/api/auth/") || path.startsWith("/login")) {
            window.location.href = url;
          }
        } catch {
          /* ignore malformed */
        }
      });
      remove = () => handle.remove();
    })();

    return () => remove?.();
  }, []);

  return null;
}
