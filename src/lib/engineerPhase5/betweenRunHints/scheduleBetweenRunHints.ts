import "server-only";

import { getOrComputeBetweenRunHint } from "@/lib/engineerPhase5/betweenRunHints/getOrComputeBetweenRunHints";

/**
 * Fire-and-forget regeneration after a run save. Swallows errors so logging never fails.
 * Future: enqueue for push notifications using the same payload shape.
 */
export function scheduleBetweenRunHintsRecompute(userId: string, primaryRunId: string): void {
  void getOrComputeBetweenRunHint(userId, primaryRunId).catch(() => {});
}
