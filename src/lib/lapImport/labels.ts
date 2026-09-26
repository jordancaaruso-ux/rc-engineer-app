import { formatRunCreatedAtDateTime } from "@/lib/formatDate";
import { sessionCompletedAtIsoFromImportedPayload } from "@/lib/lapImport/fromPayload";
import { wallClockAsUtcToInstant } from "@/lib/eventActive";
import { parseSpeedhivePracticeActivityRef } from "@/lib/speedhive/speedhivePracticeUrl";

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

/** Where a session came from, as far as its time is concerned: the importer and the address. */
export type TimingSessionRef = {
  parserId?: string | null;
  sourceUrl?: string | null;
};

/**
 * Speedhive's race results (`api2.mylaps.com` events and sessions), as opposed to its practice loop.
 *
 * The two write time differently. Race results carry the track's clock with no zone — the schedule
 * AND every lap crossing (checked live 2026-09-17: seven Japanese meetings all crossed the line
 * between 10:30 and 15:30 read that way; read as real instants they were evening racing every
 * Sunday). The practice loop sends real instants with the track's offset on them.
 */
export function isSpeedhiveRaceResultSession(session: TimingSessionRef | null | undefined): boolean {
  const parserId = session?.parserId?.trim().toLowerCase() ?? "";
  if (parserId.includes("practice")) return false;
  if (parserId === "speedhive_api_v1") return true;
  const url = session?.sourceUrl?.trim() ?? "";
  if (!/speedhive|mylaps|sporthive/i.test(url)) return false;
  return !parseSpeedhivePracticeActivityRef(url) && !/\/practice\//i.test(url);
}

/**
 * Timing pages that print the track's wall clock with no timezone, which the parsers store
 * **as-if-UTC** (see `parseLiveRcSessionDisplayTimeToUtcIso`, `parseMyRcmStartTimeToIso`,
 * `speedhiveSessionLaps.ts`). Those stored instants are ~the track's UTC offset away from reality,
 * so formatting them in any real timezone shifts the label away from what the timing screen
 * showed. LiveRC, MyRCM and Speedhive's race results do this. Speedhive's practice loop is
 * different: it returns true instants, which format correctly in the viewer's zone.
 *
 * `source` alone cannot tell Speedhive's results from its practice loop; pass the `session` it came
 * from wherever it is known. Without it a Speedhive time is read as a real instant.
 */
export function isWallClockAsUtcTimingSource(
  source: LapTimingSource | string | null | undefined,
  session?: TimingSessionRef | null
): boolean {
  if (source === "liverc" || source === "myrcm") return true;
  return source === "speedhive" && isSpeedhiveRaceResultSession(session);
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

export type ImportedSessionTimeFormatOptions = TimingSessionRef & {
  /**
   * Source of the session time; decides wall-clock-frozen vs viewer-zone display. Give the
   * session's `parserId` or `sourceUrl` too when known: a Speedhive race result is wall clock.
   */
  timingSource?: LapTimingSource | null;
  /**
   * From {@link resolveImportedSessionHasWallClockTime}. When false the ISO is an
   * import-row `createdAt` (a true instant) even on LiveRC/MyRCM, so it must NOT
   * be frozen. Defaults to true (session times from these sources are wall clock).
   */
  isWallClockTime?: boolean;
  /** IANA zone for true instants (rc_tz cookie on the server; omit on the client). */
  displayTimeZone?: string | null;
  /**
   * The track's offset from UTC when the session ran, in minutes east
   * (`sessionUtcOffsetMinutes` in the payload; Speedhive's practice loop is the one source that
   * sends it). With it, a true instant can be put on the track's clock like every other source.
   */
  utcOffsetMinutes?: number | null;
};

/**
 * Real offsets run UTC−12 to UTC+14. Inlined rather than imported from `trackClock.ts`, which
 * imports THIS file — the cycle is not worth a bounds check.
 */
function isUsableUtcOffsetMinutes(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= 14 * 60;
}

/**
 * Is this session time going to print on the TRACK's clock rather than the viewer's?
 *
 * Two ways it can: the source already stores the track's wall clock as-if-UTC (LiveRC, MyRCM,
 * Speedhive race results), or it stores a true instant and told us the track's offset
 * (Speedhive practice). A time with neither — an import-time fallback — is the viewer's.
 *
 * Exported so a row can SAY which clock it is on. Founder ruling 2026-09-18: "it should be the
 * time zone of the event in the time zone that the event was had, and the time that it was
 * imported in the time zone of the device that it was imported in."
 */
export function importedSessionTimeIsTrackClock(
  opts?: ImportedSessionTimeFormatOptions
): boolean {
  if (opts?.isWallClockTime === false) return false;
  if (isWallClockAsUtcTimingSource(opts?.timingSource, opts)) return true;
  return isUsableUtcOffsetMinutes(opts?.utcOffsetMinutes);
}

/**
 * The ISO to PRINT for an imported session, and the zone to print it in — separated from any
 * one screen's date style, so the library's "12 Sept, 2:27 PM" and a picker's "12 Sept 2026,
 * 2:27 PM" can stay different while never disagreeing about the moment.
 *
 * `timeZone: "UTC"` means the digits ARE the track's clock and must be read literally.
 */
export function importedSessionTimeForDisplay(
  sessionTimeIso: string,
  opts?: ImportedSessionTimeFormatOptions
): { iso: string; timeZone: string | undefined } {
  const viewer = { iso: sessionTimeIso, timeZone: opts?.displayTimeZone ?? undefined };
  if (!importedSessionTimeIsTrackClock(opts)) return viewer;
  // Already stored as the track's digits written as UTC — reading it in UTC gives them back.
  if (isWallClockAsUtcTimingSource(opts?.timingSource, opts)) {
    return { iso: sessionTimeIso, timeZone: "UTC" };
  }
  // A true instant plus the track's offset: shift onto the track's clock, then read it in UTC.
  const at = new Date(sessionTimeIso);
  if (Number.isNaN(at.getTime())) return viewer;
  const shifted = new Date(at.getTime() + (opts!.utcOffsetMinutes as number) * 60_000);
  return { iso: shifted.toISOString(), timeZone: "UTC" };
}

/**
 * Format an imported session time for display, on the track's clock wherever we can tell what
 * that was — what the timing screen read when the car was on track, not what the viewer's phone
 * said at that moment. A session with no on-track time at all (the ISO is then an import-row
 * `createdAt`) renders in the viewer's zone, because that is genuinely the viewer's event.
 *
 * The month is spelled ("25 Sept 2026, 9:24 PM") so no racer reads it the wrong way round
 * (`formatRunCreatedAtDateTime`).
 */
export function formatImportedSessionTime(
  sessionTimeIso: string,
  opts?: ImportedSessionTimeFormatOptions
): string {
  const { iso, timeZone } = importedSessionTimeForDisplay(sessionTimeIso, opts);
  return formatRunCreatedAtDateTime(iso, timeZone);
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

/**
 * Real instant to ask the weather service for, from an imported lap set's
 * session time. LiveRC/MyRCM/Speedhive-results session times are track wall clock
 * stored as-if-UTC (see {@link isWallClockAsUtcTimingSource}) — sending one to a
 * weather lookup unconverted reads the forecast a timezone-offset away
 * (Bendigo's 3:59 PM run was stamped with 1:59 AM's 6.9°C air, 2026-08-30).
 * Wall clocks are reinterpreted in `deviceTimeZone` (the device is at the
 * track); true instants (Speedhive practice, import-`createdAt` fallbacks) pass
 * through untouched.
 *
 * Null when there is no session time — and, unlike the run-save path's
 * conversion, also when a wall clock has no usable zone: for weather,
 * "current conditions" is a far better answer than an hour that can be ten
 * hours wrong.
 */
export function importedSessionWeatherInstantIso(
  set:
    | {
        sessionCompletedAt: string | null;
        sessionCompletedAtIsWallClock: boolean;
        sourceUrl: string | null;
      }
    | null
    | undefined,
  deviceTimeZone: string | null | undefined
): string | null {
  const raw = set?.sessionCompletedAt?.trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const isWallClock =
    set!.sessionCompletedAtIsWallClock === true &&
    isWallClockAsUtcTimingSource(timingSourceFromSourceUrl(set!.sourceUrl), { sourceUrl: set!.sourceUrl });
  if (!isWallClock) return d.toISOString();
  const tz = deviceTimeZone?.trim();
  if (!tz) return null;
  return wallClockAsUtcToInstant(d, tz).toISOString();
}
