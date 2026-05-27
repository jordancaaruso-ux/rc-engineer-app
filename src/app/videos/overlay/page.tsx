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
            Pick two local video files, blend them, and align timelines up to ±5 minutes. Use rotate/skew controls
            when camera angles differ. On mobile, tap Fullscreen for landscape viewing with overlay controls.
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

