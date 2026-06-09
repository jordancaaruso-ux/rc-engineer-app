"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Track = { id: string; name: string; location: string | null };
type JobRow = {
  id: string;
  status: string;
  createdAt: string;
  hasResult: boolean;
  analysisMode?: string;
  track: { name: string };
  profile: { name: string };
};

export function VideoAnalysisHub({ tracks }: { tracks: Track[] }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);

  useEffect(() => {
    void fetch("/api/video-analysis/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(d.jobs ?? []));
  }, []);

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <section className="rounded-lg border border-primary/40 bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Manual sector analysis (recommended)</h2>
        <p className="text-xs text-muted-foreground">
          Sync start/finish to transponder, auto-pick best 3 laps each for you and a competitor,
          then scrub the video and mark each sector crossing. Compare lap vs lap and averages.
        </p>
        <Link
          href="/videos/analysis/manual/new"
          className="inline-block rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
        >
          New manual session
        </Link>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Tracks & camera profiles</h2>
        <p className="text-xs text-muted-foreground">
          Draw sector lines on a reference still once per track layout.
        </p>
        <ul className="space-y-2">
          {tracks.map((t) => (
            <li key={t.id}>
              <Link
                href={`/videos/analysis/tracks/${t.id}`}
                className="text-sm underline hover:text-foreground"
              >
                {t.name}
              </Link>
              {t.location && (
                <span className="text-xs text-muted-foreground ml-2">{t.location}</span>
              )}
            </li>
          ))}
        </ul>
        {tracks.length === 0 && (
          <p className="text-xs text-muted-foreground">
            <Link href="/tracks" className="underline">
              Add a track
            </Link>{" "}
            first.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-medium">Recent sessions</h2>
        {jobs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sessions yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {jobs.map((j) => (
              <li key={j.id} className="flex justify-between gap-2">
                <Link href={`/videos/analysis/jobs/${j.id}`} className="underline">
                  {j.track.name} — {j.profile.name}
                  {j.analysisMode === "manual" ? " (manual)" : ""}
                </Link>
                <span className="text-xs text-muted-foreground shrink-0">
                  {j.hasResult ? "done" : j.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Python worker (optional)</p>
        <p>Automatic detection for full heats — import JSON on a worker-mode job.</p>
        <code className="block text-[10px] bg-muted/30 p-2 rounded">
          cd video-analysis && pip install -r requirements.txt
        </code>
        <Link href="/videos/analysis/manual/new" className="underline">
          Lap sync & compare
        </Link>{" "}
        — single video, ghost overlay at SF.
      </section>
    </div>
  );
}
