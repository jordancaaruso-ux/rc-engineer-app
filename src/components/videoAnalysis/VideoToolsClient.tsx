"use client";

/**
 * Slim Video tools page (VIDEO_ANALYSIS_REWORK Phase A): recent analysis
 * sessions + the video library (both resurrected from orphaned components) +
 * the advanced worker lane. Sessions stay the real home — this is the door for
 * cross-run work and orphan videos.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Film, Play, Upload } from "lucide-react";
import { Eyebrow } from "@/components/ui/panel";
import { uploadVideoToLibrary } from "@/lib/videos/clientUpload";

type JobRow = {
  id: string;
  createdAt: string;
  status: string;
  hasResult: boolean;
  hasManual?: boolean;
  analysisMode?: string;
  track?: { name?: string } | null;
  profile?: { name?: string } | null;
  run?: { id: string; sessionLabel?: string | null } | null;
};

type VideoRow = {
  id: string;
  createdAt: string;
  label: string | null;
  originalFilename: string;
  bytes: number;
};

function jobStatusLabel(j: JobRow): string {
  if (j.hasResult) return "Analyzed";
  if (j.hasManual) return "Sync in progress";
  return j.status.toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))}MB`;
}

export function VideoToolsClient() {
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [videos, setVideos] = useState<VideoRow[] | null>(null);
  /** null = idle; a number = uploading, 0–100. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploading = uploadPct !== null;

  useEffect(() => {
    void fetch("/api/video-analysis/jobs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setJobs(d?.jobs ?? []))
      .catch(() => setJobs([]));
    void fetch("/api/videos")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVideos(d?.videos ?? []))
      .catch(() => setVideos([]));
  }, []);

  async function handleUpload(file: File) {
    setUploadPct(0);
    setUploadError(null);
    try {
      await uploadVideoToLibrary(file, { onProgress: setUploadPct });
      const listRes = await fetch("/api/videos");
      if (listRes.ok) {
        const d = (await listRes.json()) as { videos?: VideoRow[] };
        setVideos(d.videos ?? []);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Eyebrow>Recent analysis sessions</Eyebrow>
          <Link
            href="/videos/analysis/manual/new"
            className="rounded-lg primary-face bg-primary px-3 py-1.5 text-[11.5px] font-semibold text-primary-foreground no-underline transition-colors hover:bg-[#E6BE00]"
          >
            New analysis
          </Link>
        </div>
        {jobs === null ? null : jobs.length === 0 ? (
          <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-xs text-muted-foreground">
            No analysis sessions yet. Start one from a run&apos;s Video section, or with New
            analysis above.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {jobs.slice(0, 12).map((j) => (
              <li
                key={j.id}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground">
                  <Play className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/videos/analysis/jobs/${encodeURIComponent(j.id)}`}
                    className="block truncate text-[12.5px] font-semibold tracking-tight text-foreground no-underline hover:underline"
                  >
                    {j.track?.name ?? "Track"} — {j.profile?.name ?? "camera"}
                  </Link>
                  <span className="type-timestamp block truncate">
                    {new Date(j.createdAt).toLocaleDateString()} · {jobStatusLabel(j)}
                  </span>
                </span>
                {j.run ? (
                  <Link
                    href={`/runs/history`}
                    className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 micro-caps text-muted-foreground no-underline hover:text-foreground"
                    title={j.run.sessionLabel ?? "Linked run"}
                  >
                    Run ↗
                  </Link>
                ) : (
                  <span className="shrink-0 micro-caps text-faint">
                    No run
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Eyebrow>Library</Eyebrow>
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-1.5 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
          >
            <Upload className="h-3 w-3" aria-hidden />
            {uploading ? `Uploading… ${uploadPct}%` : "Upload video"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mov"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
          />
        </div>
        {uploadError ? <p className="text-[11px] text-destructive">{uploadError}</p> : null}
        {videos === null ? null : videos.length === 0 ? (
          <p className="rounded-lg border border-border bg-secondary/50 px-3 py-3 text-xs text-muted-foreground">
            No saved videos. Analysis works straight off files on your phone — save one here
            when you want ghost clips available everywhere.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {videos.slice(0, 12).map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/50 px-3 py-2.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground">
                  <Film className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold tracking-tight">
                    {v.label?.trim() || v.originalFilename}
                  </span>
                  <span className="type-timestamp block">
                    {formatBytes(v.bytes)} · {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-xl border border-border bg-secondary/40">
        <summary className="cursor-pointer px-3 py-3 text-[12px] font-semibold text-muted-foreground">
          Advanced · automatic analysis (worker import)
        </summary>
        <div className="space-y-2 px-3 pb-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <p>
            Run the Python worker (<span className="tabular-nums">video-analysis/</span> in the
            repo) on a computer for automatic multi-car tracking, then import its{" "}
            <span className="tabular-nums">results.json</span> on the analysis session page.
            Results land in the same compare surface as manual marks.
          </p>
          <p>
            Worker jobs start from a track&apos;s camera profile page (sector lines +
            reference still), reachable from any analysis session.
          </p>
        </div>
      </details>
    </div>
  );
}
