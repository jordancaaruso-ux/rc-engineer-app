import "server-only";

import type { ReasoningSpineV1 } from "@/lib/engineerPhase5/reasoningSpine/types";

const HYBRID_ROUTES: ReadonlySet<ReasoningSpineV1["route"]> = new Set([
  "setup_advice",
  "planning",
  "comparison",
]);

/**
 * Mark context for hybrid retrieval: slim spread/KB in the API payload;
 * the model fetches detail via spine tools on demand.
 */
export function applyHybridContextMode(
  contextJson: Record<string, unknown>,
  spine: ReasoningSpineV1 | null
): void {
  if (!spine || !HYBRID_ROUTES.has(spine.route)) return;
  contextJson.hybridContextMode = true;
  contextJson._hybridContextNote =
    "Hybrid context: setupVsSpread rows and KB excerpts may be trimmed. Use get_param_spread, kb_search, compare_tires, or tire_history_at_track for on-demand detail.";

  const rich = contextJson.richEngineerContext;
  if (rich && typeof rich === "object" && rich !== null) {
    const r = rich as Record<string, unknown>;
    const spread = r.setupVsSpread;
    if (spread && typeof spread === "object" && spread !== null) {
      const s = spread as Record<string, unknown>;
      r.setupVsSpread = {
        ...s,
        note: `${String(s.note ?? "")} Hybrid mode: spread rows omitted — call get_param_spread.`,
        rows: [],
        truncated: true,
      };
      if (Array.isArray(r.vehicleDynamicsKb)) {
        r.vehicleDynamicsKb = (r.vehicleDynamicsKb as unknown[]).slice(0, 4);
      }
    }
    contextJson.richEngineerContext = r;
  }
}
