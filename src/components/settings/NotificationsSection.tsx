"use client";

import { useCallback, useEffect, useState } from "react";
import { CardPanel } from "@/components/ui/CardPanel";
import { PRODUCT_NAME } from "@/lib/brand/brandNames";
import {
  getExistingSubscription,
  pushSupported,
  registerServiceWorker,
  serializeSubscription,
  subscribeToPush,
} from "@/lib/webPush/pushClient";
import {
  disableNativePush,
  enableNativePush,
  hasRegisteredNativePush,
  isNativePlatform,
} from "@/lib/nativePush/nativePushClient";

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
  /** Capacitor shell — uses APNs instead of the service-worker push flow. */
  const [isNative, setIsNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [testUrl, setTestUrl] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testReport, setTestReport] = useState<string | null>(null);

  useEffect(() => {
    // In the shell the Push API is absent, so the web checks below would wrongly
    // report "unsupported" and offer the Add-to-Home-Screen advice.
    if (isNativePlatform()) {
      setIsNative(true);
      setSupported(true);
      setIosNeedsInstall(false);
      setSubscribed(hasRegisteredNativePush());
      return;
    }

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
      if (isNative) {
        const granted = await enableNativePush();
        setSubscribed(granted);
        setStatus(
          granted
            ? "Notifications enabled on this device."
            : `Notifications weren't allowed. Enable them in iOS Settings → ${PRODUCT_NAME}.`,
        );
        return;
      }

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
  }, [isNative]);

  const disable = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (isNative) {
        await disableNativePush();
        setSubscribed(false);
        setStatus("Notifications turned off on this device.");
        return;
      }

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
  }, [isNative]);

  const runWatchTest = useCallback(
    async (force: boolean) => {
      setTestBusy(true);
      setTestReport(null);
      try {
        const res = await fetch("/api/push/watch-test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speedhiveUrl: testUrl.trim() || undefined, force }),
        });
        const body = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
        setTestReport(res.ok ? body.note ?? "Done." : body.error ?? `HTTP ${res.status}`);
      } catch (e) {
        setTestReport(e instanceof Error ? e.message : "Test failed.");
      } finally {
        setTestBusy(false);
      }
    },
    [testUrl],
  );

  const sendTest = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      // The route sends to every device registered to the user and ignores the body;
      // the web branch only checks the subscription to give a clearer message first.
      if (!isNative) {
        const sub = await getExistingSubscription();
        if (!sub) {
          setStatus("Enable notifications first.");
          return;
        }
      }
      const res = await fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
  }, [isNative]);

  return (
    <CardPanel className="mt-10">
      <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Get a nudge to log a run when your transponder posts a result on Speedhive — or a reminder
        on race days at tracks without live timing. Tap opens Add Run; add laps the usual way. Beta
        — enable per device.
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
              disabled={busy || (!isNative && !VAPID)}
              onClick={() => void enable()}
              className="rounded-md border border-primary-ink primary-face bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
            >
              {busy ? "Enabling…" : "Enable notifications"}
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendTest()}
                className="rounded-md border border-primary-ink primary-face bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#E6BE00] disabled:opacity-50"
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

      {!isNative && !VAPID ? (
        <p className="mt-2 text-xs text-destructive">
          Push key missing (NEXT_PUBLIC_VAPID_PUBLIC_KEY).
        </p>
      ) : null}
      {status ? <p className="mt-2 text-xs text-muted-foreground">{status}</p> : null}

      {subscribed ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-foreground">Test result detection</h3>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Leave blank to use a Speedhive URL from one of your tracks. <strong>Check now</strong>{" "}
            runs exactly what the cron does — skips only the active-day gate, then pushes just the
            genuinely new, recent (&lt;4h) sessions; if there&apos;s nothing fresh it tells you the
            newest match and how old it is. <strong>Send test push</strong> sends a canned test
            notification to check the tap → Add Run flow — it does <em>not</em> look up real
            sessions, so it never surfaces an old run. Tapping either opens the normal Add Run — no
            laps are imported; add them the usual way.
          </p>
          <input
            type="url"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="Speedhive org/practice URL (optional)"
            className="ui-control mt-3 w-full rounded-lg border border-border bg-input px-3 py-2 text-xs text-foreground outline-none placeholder:text-faint focus:border-primary-ink"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <button
              type="button"
              disabled={testBusy}
              onClick={() => void runWatchTest(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              {testBusy ? "Checking…" : "Check now"}
            </button>
            <button
              type="button"
              disabled={testBusy}
              onClick={() => void runWatchTest(true)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Send test push
            </button>
          </div>
          {testReport ? (
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{testReport}</p>
          ) : null}
        </div>
      ) : null}
    </CardPanel>
  );
}
