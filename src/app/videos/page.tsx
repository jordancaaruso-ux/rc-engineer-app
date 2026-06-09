import type { ReactNode } from "react";
import Link from "next/link";

export default async function VideosPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-subtitle">
            Sector timing from fisheye heat video, or overlay two clips to compare lines.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link
            href="/videos/analysis"
            className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
          >
            Video analysis
          </Link>
          <Link
            href="/videos/analysis/manual/new"
            className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted"
          >
            Lap sync
          </Link>
          <Link href="/" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Home
          </Link>
        </div>
      </header>
      <section className="page-body">
        <div className="max-w-2xl rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">Video analysis</strong> — draw sector lines on a reference
            frame, run the local Python worker on 1080p60 heat footage, import JSON for sector matrix and
            fastest-in-sector stats. Link results to a Run to compare against LiveRC transponder laps.
          </p>
          <p>
            <strong className="text-foreground">Overlay compare</strong> — pick two local files in the browser
            (no upload) to blend and nudge timing.
          </p>
          <p className="text-xs">
            Large video uploads work in local dev (up to 512 MB). On Vercel, use the Python worker with a
            local file path and import JSON only.
          </p>
        </div>
      </section>
    </>
  );
}
