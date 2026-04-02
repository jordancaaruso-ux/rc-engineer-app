/**
 * Best-effort identity fields for bulk-import review tables (template-dependent keys).
 */
export function pickImportDatasetIdentityFields(parsed: unknown): {
  name?: string;
  date?: string;
  track?: string;
  race?: string;
  country?: string;
} {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const o = parsed as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const s = str(o[k]);
      if (s) return s;
    }
    return undefined;
  };
  return {
    name: get("driver_name", "name", "driver", "pilot"),
    date: get("date", "event_date", "session_date", "setup_date"),
    track: get("track", "track_name", "venue", "circuit"),
    race: get("race", "event", "event_name", "meeting"),
    country: get("country", "nation"),
  };
}
