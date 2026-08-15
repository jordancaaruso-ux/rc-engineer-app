"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 2500;
/** Long enough to cover a slow inbox, short enough that a forgotten tab stops hammering. */
const MAX_POLL_MS = 6 * 60 * 1000;

/**
 * When the magic link is opened in this same browser (usually a new tab), the session cookie
 * lands on this origin too. Poll for it and send the user straight into the app, so nobody types
 * a code they no longer need.
 *
 * This can only ever see THIS browser's cookie — `/api/auth/session` reads the jar of whoever
 * asked. A link opened in another browser or on another device is invisible from here, and that
 * is precisely the gap the code box next to this component exists to close. Bounded, because an
 * unbounded loop meant a tab left open on a phone polled until the battery went.
 */
export function VerifyRequestAutoAdvance({ callbackUrl }: { callbackUrl: string }): null {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    async function check(): Promise<boolean> {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const session = (await res.json().catch(() => null)) as { user?: unknown } | null;
        if (!cancelled && session?.user) {
          router.replace(callbackUrl);
          router.refresh();
          return true;
        }
      } catch {
        /* offline / transient — keep polling */
      }
      return false;
    }

    async function loop(): Promise<void> {
      if (cancelled || Date.now() - startedAt > MAX_POLL_MS) return;
      const done = await check();
      if (!done && !cancelled) timer = setTimeout(loop, POLL_MS);
    }

    // Re-check the instant the user returns to this tab (they clicked the link elsewhere).
    // Still worth doing past the cap — it costs one request and it's exactly when a session
    // most often exists.
    function onVisible(): void {
      if (document.visibilityState === "visible") void check();
    }
    document.addEventListener("visibilitychange", onVisible);

    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [callbackUrl, router]);

  return null;
}
