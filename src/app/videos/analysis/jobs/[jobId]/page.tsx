import type { ReactNode } from "react";
import { VideoAnalysisJobRouter } from "@/components/videoAnalysis/VideoAnalysisJobRouter";
import { PageBackLink } from "@/components/ui/PageBackLink";

type Props = { params: Promise<{ jobId: string }> };

export default async function VideoAnalysisJobPage({ params }: Props): Promise<ReactNode> {
  const { jobId } = await params;
  return (
    <>
      <header className="page-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <PageBackLink href="/videos/analysis/manual/new" />
          <div>
            <h1 className="page-title">Video analysis</h1>
            <p className="page-subtitle">Lap sync — watch video, link timing, compare laps</p>
          </div>
        </div>
      </header>
      <section className="page-body">
        <VideoAnalysisJobRouter jobId={jobId} />
      </section>
    </>
  );
}
