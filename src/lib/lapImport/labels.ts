import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/**
 * Standard primary label for a driver/run choice: driver name + session time.
 * Uses import/save time when a true "session completed" timestamp is not stored yet.
 */
export function formatDriverSessionLabel(driverName: string, sessionTimeIso: string): string {
  const t = driverName.trim() || "Driver";
  const when = formatRunCreatedAtDateTime(sessionTimeIso);
  return `${t} · ${when}`;
}
