"use client";

import { useEffect } from "react";

import { registerServiceWorker } from "@/lib/webPush/pushClient";

/**
 * Registers the service worker on load — production only, so the SW's shell cache
 * never interferes with the Turbopack dev loop (see the Turbopack CSS-wedge note).
 * Push notifications are tested against the deployed app anyway (iOS requires it).
 */
export function ServiceWorkerRegistrar(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    void registerServiceWorker();
  }, []);

  return null;
}
