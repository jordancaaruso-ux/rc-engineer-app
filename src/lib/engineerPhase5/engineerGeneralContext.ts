import type { EngineerRichContextV1 } from "@/lib/engineerPhase5/engineerRichContext";

/**
 * General-question context assembly (founder interview 2026-07-30) — the theory-only
 * subject. A general turn's context is ONLY the vehicle-dynamics KB (retrieved snippets
 * here, the full-KB system block upstream) and, when the driver scoped the chat to a car,
 * that car's IDENTITY — name, chassis, platform. Never its setup values, runs, laps, or
 * community bands.
 *
 * Pure module (no prisma, no React) so the guarantee is unit-testable: personal keys are
 * ABSENT from the assembled JSON, not nulled — a leak is a test failure and a diff smell,
 * not a quiet null.
 */

export type GeneralCarIdentity = {
  carId: string;
  name: string;
  chassis: string | null;
  /** Human platform label ("Touring car") inferred from the chassis model; null when unknown. */
  platformLabel: string | null;
  /** One display line, e.g. "TC4 — Awesomatix A800RR, Touring car". */
  line: string;
};

export function formatGeneralCarIdentityLine(car: {
  name: string;
  chassis: string | null;
  platformLabel: string | null;
}): string {
  const detail = [car.chassis, car.platformLabel].filter(Boolean).join(", ");
  return detail ? `${car.name} — ${detail}` : car.name;
}

/** Chip + persisted-thread label: "General · <car>" / "General". */
export function generalAnchorLabel(car: { name: string } | null): string {
  return car ? `General · ${car.name}` : "General";
}

/**
 * The whole contextJson for a general turn. `carIdentity` null means pure theory —
 * either the driver chose "No car" or the carId no longer resolves (degrade, never error).
 */
export function assembleGeneralChatContext(params: {
  carIdentity: GeneralCarIdentity | null;
  richEngineerContext: EngineerRichContextV1 | null;
}): Record<string, unknown> {
  return {
    contextTier: "general",
    pinnedFocus: {
      kind: "general",
      carId: params.carIdentity?.carId ?? null,
      label: generalAnchorLabel(params.carIdentity),
      pinned: true,
    },
    generalCarIdentity: params.carIdentity,
    richEngineerContext: params.richEngineerContext,
  };
}
