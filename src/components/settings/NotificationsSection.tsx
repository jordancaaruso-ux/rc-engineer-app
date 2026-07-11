"use client";

import { useCallback, useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import {
  getExistingSubscription,
  pushSupported,
  registerServiceWorker,
  serializeSubscription,
  subscribeToPush,
} from "@/lib/webPush/pushClient";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Per-device notifications opt-in + a test-push button — the surface that proves
 * the web-push plumbing end-to-end. The contextual "after first run log" prompt
 * (Engineer North Star) will reuse the same enable flow in a later pass.
 */
export function NotificationsSection() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const ok = pushSupported();
    setSupported(ok);

    const nav = window.navigator;
    const ua = nav.userAgent || "";
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
    const standalone =
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      (nav as Navigator & { standalone?: boolean }).standalone === true;
    setIosNeedsInstall(isIOS && !standalone);

    if (ok) void getExistingSubscription().then((s) => setSubscribed(Boolean(s)));
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("Notifications weren't allowed. Enable them in your browser settings.");
        return;
      }
      await registerServiceWorker();
      const sub = await subscribeToPush(VAPID);
      const serialized = sub ? serializeSubscription(sub) : null;
      if (!serialized) {
        setStatus("Could not subscribe on this device.");
        return;
      }
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: serialized, userAgent: navigator.userAgent }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSubscribed(true);
      setStatus("Notifications enabled on this device.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const sub = await getExistingSubscription();
      const endpoint = sub?.endpoint;
      if (sub) await sub.unsubscribe().catch(() => {});
      if (endpoint) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {});
      }
      setSubscribed(false);
      setStatus("Notifications turned off on this device.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to turn off notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const sub = await getExistingSubscription();
      if (!sub) {
        setStatus("Enable notifications first.");
        return;
      }
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setStatus("Test sent — check your notifications.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to send test.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Get a push when a new result posts for your transponder and when your Engineer read is
        ready. Beta — enable per device.
      </p>

      {supported === false ? (
        <p className="mt-3 text-xs text-muted-foreground">
          This browser doesn&apos;t support push notifications.
        </p>
      ) : iosNeedsInstall ? (
        <p className="mt-3 text-xs text-muted-foreground">
          On iPhone, add JRC to your Home Screen first (Share → Add to Home Screen), then open it
          from there and enable notifications.
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-3">
          {!subscribed ? (
            <button
              type="button"
              disabled={busy || !VAPID}
              onClick={() => void enable()}
              className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
            >
              {busy ? "Enabling…" : "Enable notifications"}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendTest()}
                className="rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
              >
                Send test
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void disable()}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                Turn off
              </button>
            </>
          )}
        </div>
      )}

      {!VAPID ? (
        <p className="mt-2 text-xs text-destructive">
          Push key missing (NEXT_PUBLIC_VAPID_PUBLIC_KEY).
        </p>
      ) : null}
      {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}
    </CardPanel>
  );
}
