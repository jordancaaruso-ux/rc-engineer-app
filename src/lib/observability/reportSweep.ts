import * as Sentry from "@sentry/nextjs";

/**
 * Failure reporting for the timing sweep. Two channels on purpose: Sentry (a no-op until
 * `NEXT_PUBLIC_SENTRY_DSN` is set) and a structured console line, so Vercel's runtime logs carry
 * the same facts today. A sweep that fails silently is worse than no sweep — the driver falls
 * back to the wizard and nobody knows the site changed under us.
 */

export type SweepSource = "speedhive" | "liverc";
export type SweepStage =
  | "plan"
  | "arm"
  | "poll"
  | "import"
  | "claim"
  | "file"
  | "evening"
  | "notify"
  | "store";

export type SweepFailureContext = {
  stage: SweepStage;
  source?: SweepSource;
  trackId?: string | null;
  userId?: string | null;
  url?: string | null;
};

function contextForLog(ctx: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) if (v != null) clean[k] = v;
  return JSON.stringify(clean);
}

export function reportSweepFailure(err: unknown, ctx: SweepFailureContext): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[timing-sweep] ${ctx.stage} failed ${contextForLog({ ...ctx, message })}`);
  try {
    Sentry.captureException(err, {
      tags: {
        area: "timing-sweep",
        stage: ctx.stage,
        ...(ctx.source ? { source: ctx.source } : {}),
      },
      extra: { trackId: ctx.trackId, userId: ctx.userId, url: ctx.url },
    });
  } catch {
    // Sentry itself must never take the sweep down.
  }
}

/**
 * "The page answered but we found nothing where we expected something" — the shape a silently
 * changed timing site takes. Reported once per track-day by the caller; a warning, not an error.
 */
export function reportParserSuspect(ctx: {
  source: SweepSource;
  url: string;
  trackId?: string | null;
  reason: string;
}): void {
  console.warn(`[timing-sweep] parser suspect ${contextForLog(ctx)}`);
  try {
    Sentry.captureMessage(`timing-sweep parser suspect: ${ctx.source} ${ctx.reason}`, {
      level: "warning",
      tags: { area: "timing-sweep", source: ctx.source },
      extra: { url: ctx.url, trackId: ctx.trackId },
    });
  } catch {
    // see above
  }
}
