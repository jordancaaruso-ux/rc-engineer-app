import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "./sentryInit";

/** Node runtime (route handlers, server components, server actions). Loaded from instrumentation.ts. */
Sentry.init({
  ...sharedSentryOptions(),
});
