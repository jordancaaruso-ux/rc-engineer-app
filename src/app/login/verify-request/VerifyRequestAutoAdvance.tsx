"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * When the magic link is opened in this same browser (usually a new tab), the session cookie
 * lands on this origin too. Poll for it and send the user straight into the app instead of
 * leaving them stranded on "Check your email". A link opened on a *different* device can't be
 * seen from here and simply never advances — which is the correct behaviour.
 */
export function VerifyRequestAutoAdvance({ callbackUrl }: { callbackUrl: string }): null {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

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
      if (cancelled) return;
      const done = await check();
      if (!done && !cancelled) timer = setTimeout(loop, 2500);
    }

    // Re-check the instant the user returns to this tab (they clicked the link elsewhere).
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
