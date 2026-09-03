import type { ReactNode } from "react";
import { PageBackLink } from "@/components/ui/PageBackLink";
import { VideoToolsClient } from "@/components/videoAnalysis/VideoToolsClient";

/**
 * Video — start an analysis, open one, keep a file.
 *
 * `tools-wide`: the same 1760px measure and the same three-across grid as Tools, the page the
 * `+` on its Video band opens this from (founder call 2026-09-02). The subtitle that used to
 * explain what the page was for came off with the width — the three cards say it.
 */
export default async function VideosPage(): Promise<ReactNode> {
  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/tools" />
          <div>
            <h1 className="page-title">Video</h1>
          </div>
        </div>
      </header>
      <section className="page-body tools-wide">
        <VideoToolsClient />
      </section>
    </>
  );
}
