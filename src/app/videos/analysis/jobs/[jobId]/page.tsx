import type { ReactNode } from "react";
import { VideoAnalysisJobRouter } from "@/components/videoAnalysis/VideoAnalysisJobRouter";

type Props = { params: Promise<{ jobId: string }> };

/**
 * No `page-header` here on purpose. This route is a work surface — you are drawing lines onto a
 * video frame — and an 84px title saying "Video analysis" above a step rail that already says
 * LINES cost more picture than it earned. Both flows carry their own back link and track name.
 */
export default async function VideoAnalysisJobPage({ params }: Props): Promise<ReactNode> {
  const { jobId } = await params;
  return (
    // `tools-wide`: the same desktop measure as the dashboard and Tools (110rem), so the marking
    // steps and the finished compare get the width the picture deserves.
    <section className="page-body tools-wide">
      {/* The phone's floating brand pill and avatar are what `page-header` used to clear; with
          no header, the flow has to duck under them itself. The padding goes on this wrapper,
          not on `.page-body` — that class is plain CSS and outranks a utility. */}
      <div className="pt-[calc(var(--top-chrome-y)+2.25rem)] md:pt-0">
        <VideoAnalysisJobRouter jobId={jobId} />
      </div>
    </section>
  );
}
