import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { CardPanel } from "@/components/ui/CardPanel";
import { BandHeader } from "@/components/ui/BandHeader";
import type { ToolsVideoJob } from "@/lib/tools/toolsModel";

/**
 * The video band — your analysis sessions and where each one got to.
 *
 * The one band that needed no invention: `/videos` already lists exactly this. It moves up here
 * because a job that is still syncing is a thing you are waiting on, and waiting on something
 * behind a door called "Video" means checking the door.
 *
 * State is muted text on the right, not a coloured pill. Green and red are reserved for pace and
 * quality deltas (CLAUDE.md), and a job finishing is neither — dressing it green would spend the
 * app's only "this is faster" signal on a progress bar.
 *
 * Each row goes to its RUN where it has one, because that is where the result actually reads;
 * the job page is the fallback for a session never attached to a run.
 */
export function VideoBench({ jobs }: { jobs: ToolsVideoJob[] }) {
  return (
    /* `h-full` + a flex column: on the three-across desktop Tools grid this card is stretched to
       the geometry card's height, and the list grows so the door stays on the foot. */
    <CardPanel className="h-full" contentClassName="flex h-full flex-col p-0">
      <BandHeader label="Video" addHref="/videos" addLabel="Add a video" />

      {jobs.length === 0 ? (
        <p className="flex-1 px-4 py-3 text-[13px] text-muted-foreground">
          No video analysed yet. Upload a session and it lands here.
        </p>
      ) : (
        <ul className="flex-1">
          {jobs.map((job) => (
            <li key={job.id} className="border-b border-border/60 last:border-b-0">
              <Link
                href={job.href}
                className="tap-active flex items-center justify-between gap-3 px-4 py-2.5 transition hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="ui-title block truncate text-[13px] font-semibold text-foreground">
                    {job.title}
                  </span>
                  <span className="ui-caption mt-0.5 block truncate">{job.whenLabel}</span>
                </span>
                <span className="type-timestamp shrink-0">{STATE_WORD[job.state]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/videos"
        className="tap-active mt-auto flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5 transition hover:bg-muted/40"
      >
        <span className="type-timestamp">Video workshop</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </CardPanel>
  );
}

/**
 * The driver's words, not the enum's.
 *
 * `COMPLETED` with no `resultJson` is a job that ran and produced nothing, which is not "done" to
 * anyone waiting on it — the model resolves state from the result, and these three words are all
 * that state has to say.
 */
const STATE_WORD: Record<ToolsVideoJob["state"], string> = {
  analysed: "analysed",
  "in-progress": "still working",
  failed: "didn't finish",
};
