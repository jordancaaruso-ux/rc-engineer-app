"use client";

import dynamic from "next/dynamic";

/**
 * Splits the RUM reporter (and the web-vitals code it pulls in) into its own chunk.
 * The root layout renders this only when PERF_INSTRUMENTATION=1, so with the layer off
 * the chunk is never requested. `ssr: false` because everything it does is
 * browser-only and it renders nothing.
 */
const WebVitalsReporter = dynamic(() => import("@/components/perf/WebVitalsReporter"), {
  ssr: false,
});

export function WebVitalsReporterMount(): React.ReactElement {
  return <WebVitalsReporter />;
}
