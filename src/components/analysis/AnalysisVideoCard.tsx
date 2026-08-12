import Link from "next/link";
import { ChevronRight, Video } from "lucide-react";
import type { AnalysisVideoModel } from "@/lib/analysis/analysisHomeModel";
import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

/**
 * Latest video-analysis job preview — links to the job when one exists,
 * otherwise nudges toward starting a manual analysis.
 */
export function AnalysisVideoCard({ video }: { video: AnalysisVideoModel }) {
  const href =
    video.kind === "job"
      ? `/videos/analysis/jobs/${encodeURIComponent(video.jobId)}`
      : "/videos/analysis/manual/new";

  return (
    <CardPanel contentClassName="flex flex-col gap-2.5 p-4">
      <Eyebrow dot="muted">Video</Eyebrow>
      <Link href={href} className="tap-active group flex items-center gap-3">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-border bg-background/50 text-muted-foreground transition-colors group-hover:text-foreground">
          <Video className="size-[17px]" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13.5px] font-semibold tracking-tight text-foreground">
            {video.kind === "job" ? video.title : "Analyze your latest onboard"}
          </span>
          <span className="type-timestamp truncate">
            {video.kind === "job"
              ? video.subLabel
              : "Sector timing and lap review from track video."}
          </span>
        </span>
        <ChevronRight
          className="h-4 w-4 shrink-0 text-primary-ink transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
      <Link
        href="/videos"
        className="type-timestamp self-start text-muted-foreground no-underline hover:text-foreground"
      >
        All sessions &amp; saved videos →
      </Link>
    </CardPanel>
  );
}
