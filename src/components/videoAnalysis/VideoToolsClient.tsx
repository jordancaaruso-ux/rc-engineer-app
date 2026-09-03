"use client";

/**
 * The Video page: start an analysis, open one you have made, keep a file in the library.
 *
 * Three cards across on a desktop, one column on a phone — the same grid and the same measure
 * as Tools, which is the page this one opens from (founder call 2026-09-02: "the whole screen,
 * same borders as the dashboard"). It had been a 672px column with the start button on another
 * page again; now the track picker is the first card, so "+ Add a video" on Tools lands one tap
 * from the video itself.
 *
 * Both lists stop at three rows with a "View more" under them (2026-09-03). Drawing every
 * analysis ever made was what made this page metres long. The worker-JSON lane that used to
 * sit under a `<details>` here is gone — it was two paragraphs and no link, and the worker's own
 * job page still exists for the one person who runs it.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Film, Play, Upload } from "lucide-react";
import { BandHeader } from "@/components/ui/BandHeader";
import { CardPanel } from "@/components/ui/CardPanel";
import { NewAnalysisCard } from "@/components/videoAnalysis/NewAnalysisCard";
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

/**
 * How many rows a list card shows before "View more".
 *
 * Founder call 2026-09-03: every analysis ever made was drawn at once, so the page ran metres
 * long and the Start button — level with the foot of the tallest card — sat off the bottom of
 * the monitor. Three is a glance at what you were last working on; the rest is one tap away.
 */
const PREVIEW_ROWS = 3;

/** The quiet footer that opens the rest of a list. */
function MoreRow({
  hidden,
  open,
  onToggle,
}: {
  hidden: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="tap-active border-t border-border/60 px-4 py-2.5 text-left text-[12px] font-semibold text-muted-foreground transition hover:bg-muted/40 hover:text-foreground"
    >
      {open ? "Show fewer" : `View more (${hidden})`}
    </button>
  );
}

/** The driver's word for where a session got to — muted text, never a coloured pill. */
function jobStateWord(j: JobRow): string {
  if (j.hasResult) return "analysed";
  if (j.hasManual) return "in progress";
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
  const [allJobs, setAllJobs] = useState(false);
  const [allVideos, setAllVideos] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const uploading = uploadPct !== null;
  const shownJobs = allJobs ? (jobs ?? []) : (jobs ?? []).slice(0, PREVIEW_ROWS);
  const shownVideos = allVideos ? (videos ?? []) : (videos ?? []).slice(0, PREVIEW_ROWS);

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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <NewAnalysisCard stretch />

      <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
        <BandHeader label="Analyses" />
        {jobs === null ? null : jobs.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">Nothing analysed yet.</p>
        ) : (
          <ul>
            {shownJobs.map((j) => (
              <li key={j.id} className="border-b border-border/60 last:border-b-0">
                <Link
                  href={`/videos/analysis/jobs/${encodeURIComponent(j.id)}`}
                  className="tap-active flex items-center gap-3 px-4 py-2.5 no-underline transition hover:bg-muted/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground">
                    <Play className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                      {j.track?.name ?? "Track"}
                      {j.profile?.name ? (
                        <span className="font-normal text-muted-foreground"> · {j.profile.name}</span>
                      ) : null}
                    </span>
                    <span className="ui-caption mt-0.5 block truncate">
                      {new Date(j.createdAt).toLocaleDateString()}
                      {j.run ? ` · ${j.run.sessionLabel ?? "on a run"}` : ""}
                    </span>
                  </span>
                  <span className="type-timestamp shrink-0">{jobStateWord(j)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <MoreRow
          hidden={(jobs?.length ?? 0) - PREVIEW_ROWS}
          open={allJobs}
          onToggle={() => setAllJobs((v) => !v)}
        />
      </CardPanel>

      <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
        <BandHeader
          label="Library"
          action={
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="tap-active inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-border bg-secondary px-3 text-[11.5px] font-semibold text-muted-foreground transition hover:border-primary-ink/40 hover:text-foreground disabled:opacity-60"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {uploading ? `${uploadPct}%` : "Upload"}
            </button>
          }
        />
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
        {uploadError ? <p className="px-4 pt-2 text-[11px] text-destructive">{uploadError}</p> : null}
        {videos === null ? null : videos.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            No saved videos. Analysis works straight off the file on your phone.
          </p>
        ) : (
          <ul>
            {shownVideos.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 last:border-b-0"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background/50 text-muted-foreground">
                  <Film className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                    {v.label?.trim() || v.originalFilename}
                  </span>
                  <span className="ui-caption mt-0.5 block">
                    {formatBytes(v.bytes)} · {new Date(v.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <MoreRow
          hidden={(videos?.length ?? 0) - PREVIEW_ROWS}
          open={allVideos}
          onToggle={() => setAllVideos((v) => !v)}
        />
      </CardPanel>
    </div>
  );
}
