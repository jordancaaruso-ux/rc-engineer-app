import { formatRunCreatedAtDateTime } from "@/lib/formatDate";

/**
 * Prefer true session/run instant from the timing provider; otherwise fallback (e.g. import row createdAt).
 */
export function resolveImportedSessionLabelTimeIso(
  sessionCompletedAt: Date | string | null | undefined,
  sessionCompletedAtIsoFromPayload: string | null | undefined,
  fallbackIso: string
): string {
  if (sessionCompletedAt != null) {
    const s = typeof sessionCompletedAt === "string" ? sessionCompletedAt : sessionCompletedAt.toISOString();
    if (s.trim()) return s;
  }
  const p = sessionCompletedAtIsoFromPayload?.trim();
  if (p) {
    const d = new Date(p);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallbackIso;
}

/**
 * Standard primary label for a driver/run choice: driver name + session time.
 * Pass `sessionTimeIso` from {@link resolveImportedSessionLabelTimeIso} for imports.
 */
export function formatDriverSessionLabel(driverName: string, sessionTimeIso: string): string {
  const t = driverName.trim() || "Driver";
  const when = formatRunCreatedAtDateTime(sessionTimeIso);
  return `${t} · ${when}`;
}
