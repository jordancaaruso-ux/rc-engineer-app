import * as Sentry from "@sentry/nextjs";
import { sharedSentryOptions } from "./sentryInit";

/** Edge runtime — today that is only `src/middleware.ts`. Loaded from instrumentation.ts. */
Sentry.init({
  ...sharedSentryOptions(),
});
