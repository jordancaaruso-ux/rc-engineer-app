import type { SetupFillStep } from "@/lib/setup/setupFillOrder";

/**
 * Reasoning about a parked sequential setup fill (`SetupFillDraft`).
 *
 * This is where every decision about a *stale* draft lives — a draft outlives the template it was
 * filled against, so "which question was I on" and "does this half-typed text still belong here"
 * have to be answered defensively, and answered identically by the flow and the resume card.
 *
 * Deliberately free of Prisma imports so it can be unit-tested (`@/lib/prisma` builds a client at
 * module load); the DB reads live in `getSetupFillDraft.ts`, the same split
 * `carSetupHistory.ts` / `getCarSetupHistory.ts` already uses.
 */

/** How the "34 of 68 filled" line reads everywhere it appears. */
export function setupFillDraftProgressLabel(answered: number, total: number): string {
  if (total <= 0) return "In progress";
  return `${answered} of ${total} filled`;
}

/**
 * A stored step index made safe for today's step list.
 *
 * `stepCount` (one past the last question) is a legal result and means the review screen — landing
 * there is the right answer when the sheet shrank out from under a saved index.
 */
export function clampStepIndex(index: unknown, stepCount: number): number {
  const n = typeof index === "number" && Number.isFinite(index) ? Math.floor(index) : 0;
  if (n < 0) return 0;
  return Math.min(n, Math.max(0, stepCount));
}

/**
 * The half-typed text to restore, or null.
 *
 * Only restored when it still belongs to the question the resume lands on. If the chassis schema
 * gained or lost a parameter since the draft was parked, the saved index can now point at a
 * different question — pasting "2.7-blue" into a ride height would be worse than dropping it.
 */
export function resumePendingText(
  saved: { text?: string | null; stepKey?: string | null },
  step: SetupFillStep | null | undefined
): string | null {
  if (!step) return null;
  if (!saved.text) return null;
  if (!saved.stepKey || saved.stepKey !== step.key) return null;
  return saved.text;
}

export type SetupFillDraftSubject = { carId: string } | { setupSheetModelId: string };

/**
 * Which thing a draft request is about. Exactly one subject — a row with both would satisfy both
 * unique indexes while meaning nothing, which is why the table has a CHECK constraint too.
 */
export function parseSetupFillDraftSubject(
  input: Record<string, unknown>
): SetupFillDraftSubject | { error: string } {
  const carId = typeof input.carId === "string" ? input.carId.trim() : "";
  const modelId =
    typeof input.setupSheetModelId === "string" ? input.setupSheetModelId.trim() : "";

  if (carId && modelId) {
    return { error: "Pass exactly one of carId or setupSheetModelId" };
  }
  if (carId) return { carId };
  if (modelId) return { setupSheetModelId: modelId };
  return { error: "carId or setupSheetModelId is required" };
}

/**
 * Clamp a client-reported integer before it reaches the row. Counts and indexes are display-only
 * and untrusted; this just keeps absurd values out of the table.
 */
export function clampDraftCount(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.min(Math.max(n, 0), 10_000);
}

/** Trim-and-cap a nullable client string, collapsing blanks to null. */
export function clampDraftText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export const DRAFT_PENDING_TEXT_MAX = 200;
export const DRAFT_STEP_KEY_MAX = 120;
export const DRAFT_NAME_MAX = 80;
