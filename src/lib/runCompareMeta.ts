import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/** Second line under “Me” in lap comparison (event · track · date/time). */
export function formatCompareRunMetaLine(run: {
  createdAt: Date | string;
  event?: { name: string } | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
}): string {
  const event = run.event?.name?.trim();
  const track = run.track?.name?.trim() || run.trackNameSnapshot?.trim();
  const when = formatRunCreatedAtDateTime(run.createdAt);
  const parts: string[] = [];
  if (event) parts.push(event);
  if (track) parts.push(track);
  parts.push(when);
  return parts.join(" · ");
}
