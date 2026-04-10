import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";

/**
 * Canonical instant for imported lap sessions: stored payload `sessionCompletedAtIso` → DB `sessionCompletedAt` →
 * optional discovery hint (e.g. LiveRC index row) → import row `createdAt`.
 * Use this for labels, sorting, and grouping so display time never silently tracks upload/import time when real session time exists.
 */
export function resolveImportedSessionDisplayTimeIso(input: {
  sessionCompletedAt?: Date | string | null;
  parsedPayload?: unknown;
  createdAt: Date | string;
  /**
   * When payload + DB lack a valid instant (e.g. parse gap on detail import), use a time from the watcher/index
   * discovery row before falling back to import `createdAt`. Must not override payload or DB.
   */
  sessionCompletedAtIsoHint?: string | null;
}): string {
  const fromPayload = sessionCompletedAtIsoFromImportedPayload(input.parsedPayload)?.trim();
  if (fromPayload) {
    const d = new Date(fromPayload);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (input.sessionCompletedAt != null) {
    const d =
      typeof input.sessionCompletedAt === "string"
        ? new Date(input.sessionCompletedAt.trim())
        : input.sessionCompletedAt;
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const hint = input.sessionCompletedAtIsoHint?.trim();
  if (hint) {
    const hd = new Date(hint);
    if (!Number.isNaN(hd.getTime())) return hd.toISOString();
  }
  return typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString();
}

/**
 * Legacy three-arg helper: builds a minimal payload object from an explicit ISO string when present.
 * Prefer {@link resolveImportedSessionDisplayTimeIso} with full `parsedPayload` when available.
 */
export function resolveImportedSessionLabelTimeIso(
  sessionCompletedAt: Date | string | null | undefined,
  sessionCompletedAtIsoFromPayload: string | null | undefined,
  fallbackIso: string
): string {
  const syntheticPayload =
    sessionCompletedAtIsoFromPayload != null && sessionCompletedAtIsoFromPayload.trim()
      ? { sessionCompletedAtIso: sessionCompletedAtIsoFromPayload.trim() }
      : undefined;
  return resolveImportedSessionDisplayTimeIso({
    sessionCompletedAt,
    parsedPayload: syntheticPayload,
    createdAt: fallbackIso,
  });
}

/**
 * Standard primary label for a driver/run choice: driver name + session time.
 * Pass `sessionTimeIso` from {@link resolveImportedSessionDisplayTimeIso} for imports.
 */
export function formatDriverSessionLabel(driverName: string, sessionTimeIso: string): string {
  const t = driverName.trim() || "Driver";
  const when = formatRunCreatedAtDateTime(sessionTimeIso);
  return `${t} · ${when}`;
}

/** Optional short context (e.g. track) after the primary driver · time label. */
export function formatDriverSessionLabelWithContext(
  driverName: string,
  sessionTimeIso: string,
  context?: string | null
): string {
  const base = formatDriverSessionLabel(driverName, sessionTimeIso);
  const c = context?.trim();
  if (!c) return base;
  return `${base} · ${c}`;
}
