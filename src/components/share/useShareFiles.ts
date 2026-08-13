"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hand pictures to the phone's own share sheet.
 *
 * Two paths, in order, because there is no single one that works everywhere:
 *
 *  1. **Web Share with files** — the real thing. `navigator.canShare({ files })` is the only
 *     honest test: iOS Safari and Android Chrome expose `navigator.share` for *text* on far more
 *     versions than they accept files on, so feature-detecting `share` alone hands the user a
 *     share sheet that then throws.
 *  2. **Download** — every desktop browser, and any WKWebView that refuses files. The picture
 *     lands in Downloads / Files and the user attaches it themselves. Worse, but never broken.
 *
 * ## The tap has to reach `share()` still warm
 *
 * WebKit will only open the share sheet while the gesture that asked for it is still live. The
 * first version fetched both pictures and *then* called `navigator.share()` — two server-side
 * 1080px renders, seconds apart from the tap — and iOS answered every share on the home-screen
 * PWA with "The request is not allowed by the user agent or the platform in the current context"
 * (a `NotAllowedError`, thrown from `share()` itself, one line after `canShare({files})` had
 * already said yes). Nothing was denied; the activation had simply expired.
 *
 * So the fetching moved off the tap. {@link ShareFilesApi.prefetch} pulls the pictures down while
 * the driver is still looking at the preview, and `share()` calls `navigator.share()` as its very
 * first statement with files already in hand — no `await`, no state update, nothing between the
 * gesture and the platform. The slow path survives for anything not prefetched (desktop, a cache
 * miss), where the activation rule is not enforced.
 *
 * Both render routes answer `Cache-Control: private, max-age=300`, so a prefetch of a picture the
 * preview `<img>` already loaded is served from the browser's own cache and costs no second render.
 *
 * UNVERIFIED ON THE iOS CAPACITOR SHELL. In a phone browser and in the installed PWA this is
 * standard; inside Capacitor's WKWebView file sharing is the case that tends to fail, and
 * `@capacitor/share` is not a dependency of this project. The detection above means the shell
 * degrades to a download rather than an error — but "it works on the iPhone app" is not a claim
 * this code can make on its own.
 */

export type ShareTarget = {
  url: string;
  filename: string;
  /**
   * Drop this file rather than failing the whole share when it can't be drawn. The setup sheet is
   * optional because not every chassis has one the app can draw — without this, a run share on
   * such a car would fail entirely over an attachment the driver would have shrugged at.
   */
  optional?: boolean;
};

export type ShareState = "idle" | "working" | "shared" | "downloaded" | "error";

async function fetchAsFile(target: ShareTarget): Promise<File> {
  const res = await fetch(target.url);
  if (!res.ok) {
    // The routes answer with JSON on failure; surface their sentence, not a status code.
    const message = await res
      .json()
      .then((p: { error?: string }) => p.error)
      .catch(() => null);
    throw new Error(message || `Could not draw the picture (${res.status})`);
  }
  const blob = await res.blob();
  return new File([blob], target.filename, { type: blob.type || "image/png" });
}

/**
 * Synchronous, and deliberately so — it runs inside the tap, between the gesture and
 * `navigator.share()`. Anything awaited here would cost the activation the whole fix is about.
 */
function canShareFiles(files: File[]): boolean {
  return (
    files.length > 0 &&
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    typeof navigator.share === "function" &&
    navigator.canShare({ files })
  );
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  // Revoke on the next turn — Safari has been known to cancel an in-flight download otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useShareFiles() {
  const [state, setState] = useState<ShareState>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Set when an optional attachment couldn't be drawn, so the sheet can explain the gap. */
  const [skipped, setSkipped] = useState<string | null>(null);

  /**
   * url → the drawn picture, or `null` for an optional one that could not be drawn. A `null` is a
   * *resolved* answer, not a miss: it means "asked, and there is nothing to send", which is what
   * lets the fast path proceed without waiting on a picture that will never arrive.
   */
  const drawn = useRef(new Map<string, File | null>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /**
   * True while pictures are being drawn ahead of the tap. The caller shows its busy state, which
   * is what stops a driver tapping into the slow path and meeting the very error this avoids —
   * the preview is usually ready first, but a second, freshly-rendered setup sheet is not.
   */
  const [preparing, setPreparing] = useState(false);
  const inFlight = useRef(0);

  /** Draw the pictures now, so the tap that sends them doesn't have to wait. */
  const prefetch = useCallback(async (targets: ShareTarget[]) => {
    const wanted = new Set(targets.map((t) => t.url));
    // A driver walking the chip row mints a URL per tap; without this the map grows all session.
    for (const url of [...drawn.current.keys()]) {
      if (!wanted.has(url)) drawn.current.delete(url);
    }
    if (targets.every((t) => drawn.current.has(t.url))) return;

    inFlight.current += 1;
    setPreparing(true);
    try {
      await Promise.all(
        targets.map(async (t) => {
          if (drawn.current.has(t.url)) return;
          try {
            const file = await fetchAsFile(t);
            drawn.current.set(t.url, file);
          } catch {
            // Only optional misses are remembered. A failed card is left unresolved so the tap
            // takes the slow path and the driver sees the real error instead of a silent no-op.
            if (t.optional) drawn.current.set(t.url, null);
          }
        })
      );
    } finally {
      inFlight.current -= 1;
      // Chip taps overlap prefetches; only the last one out turns the light off.
      if (inFlight.current === 0 && alive.current) setPreparing(false);
    }
  }, []);

  const shareSlowly = useCallback(
    async (targets: ShareTarget[], meta: { title: string; text?: string }) => {
      try {
        const fetched = await Promise.all(
          targets.map(async (t) => {
            if (!t.optional) return fetchAsFile(t);
            try {
              return await fetchAsFile(t);
            } catch (e) {
              setSkipped(e instanceof Error ? e.message : "One attachment could not be drawn.");
              return null;
            }
          })
        );
        const files = fetched.filter((f): f is File => f !== null);

        if (canShareFiles(files)) {
          try {
            await navigator.share({ files, title: meta.title, text: meta.text });
            setState("shared");
            return;
          } catch (e) {
            // Dismissing the OS sheet is a decision, not a failure.
            if (e instanceof DOMException && e.name === "AbortError") {
              setState("idle");
              return;
            }
            throw e;
          }
        }

        for (const file of files) download(file);
        setState("downloaded");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sharing failed");
        setState("error");
      }
    },
    []
  );

  /**
   * NOT async. The fast path's whole job is to reach `navigator.share()` with the user's tap still
   * warm, so the call is the first statement and every `await` lives behind it.
   */
  const share = useCallback(
    (targets: ShareTarget[], meta: { title: string; text?: string }) => {
      if (targets.length === 0) return;
      setError(null);
      setSkipped(null);

      const resolved = targets.every((t) => drawn.current.has(t.url));
      if (resolved) {
        const files = targets
          .map((t) => drawn.current.get(t.url) ?? null)
          .filter((f): f is File => f !== null);
        const missed = targets.find((t) => drawn.current.get(t.url) === null);

        if (canShareFiles(files)) {
          // First statement. Nothing — not a state update, not a log — goes above this line.
          const sharing = navigator.share({ files, title: meta.title, text: meta.text });
          setState("working");
          if (missed) setSkipped("Your setup sheet couldn't be drawn, so only the run was sent.");
          void sharing
            .then(() => {
              if (alive.current) setState("shared");
            })
            .catch((e: unknown) => {
              if (!alive.current) return;
              if (e instanceof DOMException && e.name === "AbortError") {
                setState("idle");
                return;
              }
              setError(e instanceof Error ? e.message : "Sharing failed");
              setState("error");
            });
          return;
        }

        // No file sharing here — hand them over as downloads, still inside the gesture.
        if (files.length > 0) {
          for (const file of files) download(file);
          setState("downloaded");
          if (missed) setSkipped("Your setup sheet couldn't be drawn, so only the run was saved.");
          return;
        }
      }

      // Nothing drawn yet: fetch and send the old way. The activation rule bites on iOS, but iOS
      // is exactly where the preview has already warmed the cache, so this is the desktop path.
      setState("working");
      void shareSlowly(targets, meta);
    },
    [shareSlowly]
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setSkipped(null);
  }, []);

  return { share, prefetch, preparing, state, error, skipped, reset };
}
