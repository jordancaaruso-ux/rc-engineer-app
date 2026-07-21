"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

import { refreshNativePushToken } from "@/lib/nativePush/nativePushClient";

/**
 * Native push wiring for the Capacitor shell:
 *
 *  - routes a notification tap to `data.url` (same payload contract as the web-push
 *    service worker's `notificationclick`, so triggers send one shape for both),
 *  - re-sends the APNs token on launch, because tokens rotate (reinstall, restore
 *    from backup) and a stale row silently stops delivering.
 *
 * Deliberately does **not** prompt for permission — Apple discourages a cold prompt
 * on launch, and the ask lives in Settings → Notifications. This only acts when
 * permission was already granted.
 */
export function CapacitorPushBridge(): null {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      handles.push(
        await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const url = action.notification.data?.url;
            if (typeof url === "string" && url.startsWith("/")) {
              router.push(url);
            }
          },
        ),
      );

      if (cancelled) return;
      // Best effort: a failed refresh must never block app start.
      await refreshNativePushToken().catch(() => {});
    })();

    return () => {
      cancelled = true;
      for (const h of handles) void h.remove();
    };
  }, [router]);

  return null;
}
