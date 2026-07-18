"use client";

import dynamic from "next/dynamic";

/** Chart JS off the analysis hub entry; SSR HTML unchanged (ssr default true). */
export const SessionTrendCard = dynamic(() =>
  import("@/components/analysis/SessionTrendCard").then((m) => ({
    default: m.SessionTrendCard,
  }))
);
