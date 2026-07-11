import type { ReactNode } from "react";
import { VideoToolsClient } from "@/components/videoAnalysis/VideoToolsClient";

export default async function VideosPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Video</h1>
          <p className="page-subtitle">
            Analysis sessions, saved videos, and advanced tools. Results live on each
            run&apos;s Video section — this is the workshop.
          </p>
        </div>
      </header>
      <section className="page-body">
        <VideoToolsClient />
      </section>
    </>
  );
}
