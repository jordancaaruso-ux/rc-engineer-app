import type { ReactNode } from "react";
import Link from "next/link";
import { CardPanel } from "@/components/ui/CardPanel";

export default async function VideosPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Videos</h1>
          <p className="page-subtitle">
            Sync onboard video to LiveRC laps and compare two drivers on one clip.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link
            href="/videos/analysis/manual/new"
            className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground"
          >
            Lap sync
          </Link>
          <Link href="/" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Home
          </Link>
        </div>
      </header>
      <section className="page-body">
        <CardPanel className="max-w-2xl" contentClassName="text-sm text-muted-foreground space-y-3">
          <p>
            Upload a heat or practice video, optionally paste LiveRC timing URLs, anchor start/finish
            on the video, then overlay two laps at 50% to compare lines.
          </p>
          <p className="text-xs">
            Video stays in your browser — only timing links and sync marks are saved to your account.
          </p>
        </CardPanel>
      </section>
    </>
  );
}
