"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * While a setup document is still importing (e.g. the AI reader runs after the upload
 * response — SETUP_UPLOAD_NORTH_STAR.md Stage 1), re-render the server page every few
 * seconds so parsed values appear without a manual reload. Stops once processing ends
 * (the page re-renders with active=false) or after ~6 minutes as a safety cap.
 */
export function AutoRefreshWhileProcessing({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > 6 * 60_000) {
        window.clearInterval(id);
        return;
      }
      router.refresh();
    }, 4000);
    return () => window.clearInterval(id);
  }, [active, router]);

  if (!active) return null;
  return (
    <div className="mb-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-primary align-middle" />
      Reading the setup sheet — values will appear here automatically (usually 1–3 minutes).
    </div>
  );
}
