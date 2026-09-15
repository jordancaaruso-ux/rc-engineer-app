import { fetchRunConditionsFromOpenMeteo } from "@/lib/weather/openMeteo";
import {
  normalizeRunConditionsInput,
  type RunConditionsRecord,
} from "@/lib/weather/runConditionsRecord";

/**
 * Effortless-capture backfill: fetch run conditions server-side for a pinned
 * track when the client attached none (fast save, a transient weather-fetch
 * failure, or the client fetch simply not landing before submit). Reuses the
 * client's normalize/clamp path so stored columns match a client-side capture,
 * and preserves the Open-Meteo source stamp. Best-effort — any failure
 * (network, no reading for that time/place) resolves to null and the run saves
 * without conditions, exactly as before.
 */
export async function backfillRunConditionsFromTrack(params: {
  latitude: number;
  longitude: number;
  atIso: string | null;
}): Promise<RunConditionsRecord | null> {
  try {
    const conditions = await fetchRunConditionsFromOpenMeteo({
      latitude: params.latitude,
      longitude: params.longitude,
      atIso: params.atIso,
    });
    return normalizeRunConditionsInput(conditions);
  } catch {
    return null;
  }
}
