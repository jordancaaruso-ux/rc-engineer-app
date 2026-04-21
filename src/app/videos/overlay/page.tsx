import type { ReactNode } from "react";
import Link from "next/link";
import { VideoOverlayClient } from "@/components/videos/VideoOverlayClient";

export default async function VideoOverlayPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Video overlay</h1>
          <p className="page-subtitle">
            Pick two local video files, then blend them (opacity) and nudge time offset to compare lines. Works best
            from the same camera position.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 self-start">
          <Link href="/" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-muted">
            Home
          </Link>
        </div>
      </header>
      <section className="page-body">
        <VideoOverlayClient />
      </section>
    </>
  );
}

