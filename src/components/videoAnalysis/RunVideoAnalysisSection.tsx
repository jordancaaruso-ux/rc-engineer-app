"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type JobRow = {
  id: string;
  status: string;
  hasResult: boolean;
  profile: { name: string };
};

export function RunVideoAnalysisSection({
  runId,
  trackId,
}: {
  runId: string;
  trackId: string | null;
}) {
  const [jobs, setJobs] = useState<JobRow[]>([]);

  useEffect(() => {
    void fetch(`/api/video-analysis/jobs?runId=${encodeURIComponent(runId)}`)
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []));
  }, [runId]);

  if (!trackId) {
    return (
      <p className="text-xs text-muted-foreground">
        Set a track on this run to use video sector analysis.
      </p>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/videos/analysis/tracks/${trackId}`}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Camera profile
        </Link>
        <Link
          href={`/videos/analysis/manual/new?trackId=${trackId}&runId=${runId}`}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Manual sector analysis
        </Link>
      </div>
      {jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No video analysis linked yet.</p>
      ) : (
        <ul className="text-xs space-y-1">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={`/videos/analysis/jobs/${j.id}`} className="underline">
                {j.profile.name}
              </Link>
              <span className="text-muted-foreground ml-2">
                {j.hasResult ? "results ready" : j.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
