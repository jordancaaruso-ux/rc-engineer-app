import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/** Prefer on-track session time when stored; else app save time. */
export function resolveRunDisplayInstant(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
}): Date {
  const s = run.sessionCompletedAt;
  if (s != null) {
    const d = typeof s === "string" ? new Date(s) : s;
    if (!Number.isNaN(d.getTime())) return d;
  }
  return typeof run.createdAt === "string" ? new Date(run.createdAt) : run.createdAt;
}

/** Second line under “Me” in lap comparison (event · track · session/save time). */
export function formatCompareRunMetaLine(run: {
  createdAt: Date | string;
  sessionCompletedAt?: Date | string | null;
  event?: { name: string } | null;
  track?: { name: string } | null;
  trackNameSnapshot?: string | null;
}): string {
  const event = run.event?.name?.trim();
  const track = run.track?.name?.trim() || run.trackNameSnapshot?.trim();
  const when = formatRunCreatedAtDateTime(resolveRunDisplayInstant(run));
  const parts: string[] = [];
  if (event) parts.push(event);
  if (track) parts.push(track);
  parts.push(when);
  return parts.join(" · ");
}
