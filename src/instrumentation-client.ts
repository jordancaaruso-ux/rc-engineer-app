import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "./lib/observability/sentryInit";

/**
 * Browser-side Sentry. Next.js loads this file before the app hydrates, so an error thrown in
 * a client component, an event handler, or a `fetch` callback reaches Sentry with the URL and
 * the browser it happened in. Inert without `NEXT_PUBLIC_SENTRY_DSN`.
 *
 * No session replay, no tracing: those are the two things that make a Sentry client bundle
 * heavy and the free tier run out. Errors only.
 */
Sentry.init({
  ...sharedSentryOptions(),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
