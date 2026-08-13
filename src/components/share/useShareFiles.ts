"use client";

import { useCallback, useState } from "react";

/**
 * Hand pictures to the phone's own share sheet.
 *
 * Three paths, in order, because there is no single one that works everywhere:
 *
 *  1. **Web Share with files** — the real thing. `navigator.canShare({ files })` is the only
 *     honest test: iOS Safari and Android Chrome expose `navigator.share` for *text* on far more
 *     versions than they accept files on, so feature-detecting `share` alone hands the user a
 *     share sheet that then throws.
 *  2. **Download** — every desktop browser, and any WKWebView that refuses files. The picture
 *     lands in Downloads / Files and the user attaches it themselves. Worse, but never broken.
 *
 * UNVERIFIED ON THE iOS SHELL. In a phone browser this is standard; inside Capacitor's
 * WKWebView, file sharing is the case that tends to fail, and `@capacitor/share` is not a
 * dependency of this project. The detection above means the shell degrades to a download rather
 * than an error — but "it works on the iPhone app" is not a claim this code can make on its own.
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

  const share = useCallback(
    async (targets: ShareTarget[], meta: { title: string; text?: string }) => {
      if (targets.length === 0) return;
      setState("working");
      setError(null);
      setSkipped(null);
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

        const canShareFiles =
          typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" &&
          typeof navigator.share === "function" &&
          navigator.canShare({ files });

        if (canShareFiles) {
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

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setSkipped(null);
  }, []);

  return { share, state, error, skipped, reset };
}
