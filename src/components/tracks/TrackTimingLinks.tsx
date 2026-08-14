import { CardPanel } from "@/components/ui/CardPanel";
import { Eyebrow } from "@/components/ui/panel";

function hostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function TimingLinkRow(props: { label: string; url: string }) {
  return (
    <a
      href={props.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 transition-colors hover:bg-muted"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">Open in {props.label} ↗</span>
        <span className="block truncate tabular-nums text-[11px] text-muted-foreground">{hostLabel(props.url)}</span>
      </span>
    </a>
  );
}

/**
 * Read-only timing links, visible to any signed-in user viewing a track.
 * Editing the URLs stays with the creator/admin (see TrackLiveRcUrlEditor / TrackSpeedhiveUrlEditor).
 * Renders nothing when the track has no timing URLs.
 */
export function TrackTimingLinks(props: {
  liveRcUrl: string | null;
  speedhiveUrl: string | null;
}) {
  const liveRc = props.liveRcUrl?.trim();
  const speedhive = props.speedhiveUrl?.trim();
  if (!liveRc && !speedhive) return null;

  return (
    <CardPanel contentClassName="text-sm space-y-2">
      <Eyebrow className="mb-1">Timing</Eyebrow>
      <div className="grid gap-2">
        {liveRc ? <TimingLinkRow label="LiveRC" url={liveRc} /> : null}
        {speedhive ? <TimingLinkRow label="Speedhive" url={speedhive} /> : null}
      </div>
    </CardPanel>
  );
}
