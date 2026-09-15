"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The page a driver sees when the root layout itself throws — the one place a React error
 * cannot be caught by anything below it. Next.js swaps the whole document for this component,
 * so it has to carry its own <html> and <body>; the app's fonts, tokens and shell are not
 * available here, which is why the styles are inline and plain.
 *
 * Its one job beyond "try again" is to report the crash: without this file a full-page
 * failure is invisible to Sentry, because the client init in instrumentation-client.ts
 * hooks React's error boundary and a root-layout error escapes every boundary.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" data-theme="light">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#EDEAE3",
          color: "#1A1917",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
          <p style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</p>
          <p style={{ fontSize: 14, margin: "0 0 20px", opacity: 0.7 }}>
            It has been reported. Nothing you logged is lost.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              appearance: "none",
              border: 0,
              borderRadius: 10,
              background: "#FFD60A",
              color: "#1A1917",
              fontSize: 14,
              fontWeight: 600,
              padding: "12px 22px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <p style={{ fontSize: 13, margin: "16px 0 0" }}>
            {/* A plain anchor on purpose: the router that <Link> needs is part of what just crashed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ color: "inherit" }}>
              Back to the dashboard
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
