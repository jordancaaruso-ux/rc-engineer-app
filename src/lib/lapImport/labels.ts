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

/** True when payload, DB session time, or discovery hint gives an on-track wall time (not import `createdAt`). */
export function resolveImportedSessionHasWallClockTime(input: {
  sessionCompletedAt?: Date | string | null;
  parsedPayload?: unknown;
  sessionCompletedAtIsoHint?: string | null;
}): boolean {
  const fromPayload = sessionCompletedAtIsoFromImportedPayload(input.parsedPayload)?.trim();
  if (fromPayload) {
    const d = new Date(fromPayload);
    if (!Number.isNaN(d.getTime())) return true;
  }
  if (input.sessionCompletedAt != null) {
    const d =
      typeof input.sessionCompletedAt === "string"
        ? new Date(input.sessionCompletedAt.trim())
        : input.sessionCompletedAt;
    if (!Number.isNaN(d.getTime())) return true;
  }
  const hint = input.sessionCompletedAtIsoHint?.trim();
  if (hint) {
    const hd = new Date(hint);
    if (!Number.isNaN(hd.getTime())) return true;
  }
  return false;
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

export type LapTimingSource = "liverc" | "myrcm" | "speedhive";

/**
 * LiveRC and MyRCM pages expose track wall-clock times with no timezone, and the
 * parsers store them **as-if-UTC** (see `parseLiveRcSessionDisplayTimeToUtcIso`,
 * `parseMyRcmStartTimeToIso`). Those stored instants are ~the track's UTC offset
 * away from reality, so formatting them in any real timezone shifts the label away
 * from what the timing screen showed. Speedhive is different: its APIs return true
 * instants (epoch / offset ISO), which format correctly in the viewer's zone.
 */
export function isWallClockAsUtcTimingSource(
  source: LapTimingSource | string | null | undefined
): boolean {
  return source === "liverc" || source === "myrcm";
}

/** Timing source from an import block / session `parserId` (e.g. "liverc-race-result"). */
export function timingSourceFromParserId(
  parserId: string | null | undefined
): LapTimingSource | null {
  const p = parserId?.toLowerCase() ?? "";
  if (p.includes("speedhive")) return "speedhive";
  if (p.includes("liverc")) return "liverc";
  if (p.includes("myrcm")) return "myrcm";
  return null;
}

/** Timing source from a session/source URL. */
export function timingSourceFromSourceUrl(
  url: string | null | undefined
): LapTimingSource | null {
  const u = url?.toLowerCase() ?? "";
  if (/speedhive|mylaps|sporthive/.test(u)) return "speedhive";
  if (u.includes("liverc")) return "liverc";
  if (u.includes("myrcm")) return "myrcm";
  return null;
}

export type ImportedSessionTimeFormatOptions = {
  /** Source of the session time; decides wall-clock-frozen vs viewer-zone display. */
  timingSource?: LapTimingSource | null;
  /**
   * From {@link resolveImportedSessionHasWallClockTime}. When false the ISO is an
   * import-row `createdAt` (a true instant) even on LiveRC/MyRCM, so it must NOT
   * be frozen. Defaults to true (session times from these sources are wall clock).
   */
  isWallClockTime?: boolean;
  /** IANA zone for true instants (rc_tz cookie on the server; omit on the client). */
  displayTimeZone?: string | null;
};

/**
 * Format an imported session time for display. Wall-clock-as-UTC sources (LiveRC,
 * MyRCM) render frozen in UTC so the label always matches the timing screen at the
 * track; true instants (Speedhive, import-time fallbacks) render in the viewer's zone.
 */
export function formatImportedSessionTime(
  sessionTimeIso: string,
  opts?: ImportedSessionTimeFormatOptions
): string {
  const frozen =
    isWallClockAsUtcTimingSource(opts?.timingSource) && opts?.isWallClockTime !== false;
  return formatRunCreatedAtDateTime(
    sessionTimeIso,
    frozen ? "UTC" : opts?.displayTimeZone ?? undefined
  );
}

/**
 * Standard primary label for a driver/run choice: driver name + session time.
 * Pass `sessionTimeIso` from {@link resolveImportedSessionDisplayTimeIso} for imports,
 * and `opts` so LiveRC/MyRCM wall-clock times stay frozen (see
 * {@link formatImportedSessionTime}); without `opts` the time renders in the runtime zone.
 */
export function formatDriverSessionLabel(
  driverName: string,
  sessionTimeIso: string,
  opts?: ImportedSessionTimeFormatOptions
): string {
  const t = driverName.trim() || "Driver";
  const when = formatImportedSessionTime(sessionTimeIso, opts);
  return `${t} · ${when}`;
}

/** Optional short context (e.g. track) after the primary driver · time label. */
export function formatDriverSessionLabelWithContext(
  driverName: string,
  sessionTimeIso: string,
  context?: string | null,
  opts?: ImportedSessionTimeFormatOptions
): string {
  const base = formatDriverSessionLabel(driverName, sessionTimeIso, opts);
  const c = context?.trim();
  if (!c) return base;
  return `${base} · ${c}`;
}
