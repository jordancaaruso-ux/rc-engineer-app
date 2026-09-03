"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { NewAnalysisCard } from "@/components/videoAnalysis/NewAnalysisCard";

/**
 * New analysis, as its own page.
 *
 * The Video page carries the same card in its first cell; this route stays for the doors that
 * arrive with the track and the run already known — a run's Video section links here with both
 * in the query string. Same card, full width, the same measure as the dashboard.
 */
function NewAnalysisPage() {
  const sp = useSearchParams();
  const runId = sp.get("runId") ?? "";
  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href={runId ? "/runs/history" : "/videos"} />
          <div>
            <h1 className="page-title">New analysis</h1>
          </div>
        </div>
      </header>
      <section className="page-body tools-wide">
        <NewAnalysisCard
          presetTrackId={sp.get("trackId") ?? ""}
          presetProfileId={sp.get("profileId") ?? ""}
          presetRunId={runId}
        />
      </section>
    </>
  );
}

export default function NewManualVideoAnalysisPage() {
  return (
    <Suspense>
      <NewAnalysisPage />
    </Suspense>
  );
}
