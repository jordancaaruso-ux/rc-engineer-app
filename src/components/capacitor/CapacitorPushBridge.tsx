"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

import { ActionToast } from "@/components/ui/ActionToast";
import { refreshNativePushToken } from "@/lib/nativePush/nativePushClient";

/**
 * Native push wiring for the Capacitor shell:
 *
 *  - routes a notification tap to `data.url` (same payload contract as the web-push
 *    service worker's `notificationclick`, so triggers send one shape for both),
 *  - shows a notification that lands while the app is open, as a toast. iOS hands those
 *    to the app instead of the screen, and the shell sets no `presentationOptions`, so
 *    without this they vanished: no banner, nothing in Notification Centre. That is how
 *    Send test looked broken on the first TestFlight build (2026-09-25): Apple delivered
 *    it while the Settings page was still open. It lives here, in the hosted web app, so it
 *    reaches builds already installed; setting `presentationOptions` in a later build
 *    would show each notification twice,
 *  - re-sends the APNs token on launch, because tokens rotate (reinstall, restore
 *    from backup) and a stale row silently stops delivering.
 *
 * Deliberately does **not** prompt for permission — Apple discourages a cold prompt
 * on launch, and the ask lives in Settings → Notifications. This only acts when
 * permission was already granted.
 */
type OpenAppNotification = { seq: number; title: string | null; body: string; url: string | null };

export function CapacitorPushBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const [shown, setShown] = useState<OpenAppNotification | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];
    // A cleanup that ran while a listener was still being added must not leave that listener behind.
    const keep = (handle: { remove: () => Promise<void> }) => {
      if (cancelled) void handle.remove();
      else handles.push(handle);
    };

    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");

      keep(
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

      keep(
        await PushNotifications.addListener("pushNotificationReceived", (notification) => {
          const title = notification.title?.trim() || null;
          const body = notification.body?.trim() || null;
          if (!title && !body) return;
          const url = notification.data?.url;
          seq.current += 1;
          setShown({
            seq: seq.current,
            // A title with no body still shows, as the message itself.
            title: body ? title : null,
            body: body ?? title ?? "",
            url: typeof url === "string" && url.startsWith("/") ? url : null,
          });
        }),
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

  if (!shown) return null;
  // "Open" would only reload the page the driver is already on.
  const openUrl = shown.url && shown.url !== pathname ? shown.url : null;

  return (
    <ActionToast
      // A second notification restarts the timer even when its words match the first.
      key={shown.seq}
      title={shown.title}
      message={shown.body}
      action={openUrl ? { label: "Open", onClick: () => router.push(openUrl) } : null}
      onDismiss={() => setShown(null)}
    />
  );
}
