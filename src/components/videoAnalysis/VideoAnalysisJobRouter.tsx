"use client";

import { useEffect, useState } from "react";
import { VideoAnalysisJobClient } from "./VideoAnalysisJobClient";
import { ManualVideoAnalysisClient } from "./ManualVideoAnalysisClient";

export function VideoAnalysisJobRouter({ jobId }: { jobId: string }) {
  const [mode, setMode] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/video-analysis/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => setMode(d.job?.analysisMode ?? "worker"));
  }, [jobId]);

  if (mode === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (mode === "manual") {
    return <ManualVideoAnalysisClient jobId={jobId} />;
  }

  return <VideoAnalysisJobClient jobId={jobId} />;
}
