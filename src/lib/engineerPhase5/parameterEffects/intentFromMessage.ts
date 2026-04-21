import "server-only";

import type { Outcome, OutcomeDirection } from "./types";

/**
 * Phase B intent classifier — detects whether a free-text Engineer user message
 * is asking how to change a catalogued outcome (`Outcome` × `OutcomeDirection`).
 *
 * Current implementation is keyword-based: a closed list of phrases per
 * (outcome, direction) pair. First match wins. This is deliberately
 * conservative — false positives route the user through the structured path
 * and force the Engineer to ground its reply in the catalog (which is fine when
 * the intent is at all about setup tuning), while false negatives fall through
 * to the existing keyword-retrieval path (Phase A) with no regression.
 *
 * Upgrade path: replace `INTENT_PATTERNS` with a small LLM classifier if the
 * phrase list becomes unwieldy. The function signature is designed to be a
 * drop-in.
 */

type IntentPattern = {
  outcome: Outcome;
  direction: OutcomeDirection;
  /** Lowercase phrases matched via `.includes` against the lowercased message. */
  phrases: readonly string[];
};

/**
 * Order matters: the first pattern whose phrase appears in the message wins,
 * so more-specific phrases should come before broader ones. Within a pattern,
 * phrase order is irrelevant.
 */
const INTENT_PATTERNS: readonly IntentPattern[] = [
  {
    outcome: "rear_grip",
    direction: "increase",
    phrases: [
      "more rear grip",
      "add rear grip",
      "get more rear grip",
      "improve rear grip",
      "rear traction",
      "more traction at the rear",
      "more grip at the rear",
      "rear is loose",
      "loose rear",
      "loose in the rear",
      "rear slides",
      "rear sliding",
      "rear keeps stepping out",
      "rear steps out",
    ],
  },
  {
    outcome: "rear_grip",
    direction: "decrease",
    phrases: [
      "less rear grip",
      "reduce rear grip",
      "rear is too planted",
      "rear is too stable",
      "car feels too tight",
      "too tight rear",
    ],
  },
  {
    outcome: "front_grip",
    direction: "increase",
    phrases: [
      "more front grip",
      "add front grip",
      "more front bite",
      "more steering",
      "more turn in",
      "more turn-in",
      "improve front",
      "front understeers",
      "understeer",
      "car pushes",
      "pushing mid",
      "pushes mid",
      "pushes on entry",
      "pushes on exit",
      "front traction",
    ],
  },
  {
    outcome: "front_grip",
    direction: "decrease",
    phrases: [
      "less front grip",
      "reduce front bite",
      "too much front",
      "darty",
      "oversteer on entry",
    ],
  },
  {
    outcome: "rear_rotation",
    direction: "increase",
    phrases: [
      "more rotation",
      "rotate more",
      "more rear rotation",
      "car won't rotate",
      "wont rotate",
      "won't turn",
      "slow rotation",
      "lazy rotation",
      "lazy mid",
      "lazy mid-corner",
    ],
  },
  {
    outcome: "rear_rotation",
    direction: "decrease",
    phrases: [
      "less rotation",
      "too much rotation",
      "rotates too much",
      "spins easily",
      "snap oversteer",
    ],
  },
  {
    outcome: "on_power_stability",
    direction: "increase",
    phrases: [
      "on power stability",
      "on-power stability",
      "more stability on power",
      "more stable on power",
      "more stable on throttle",
      "unstable on power",
      "loose on power",
      "loose on exits",
      "loose on exit",
      "squirrelly on throttle",
      "squirms on throttle",
    ],
  },
  {
    outcome: "corner_speed",
    direction: "increase",
    phrases: [
      "more corner speed",
      "increase corner speed",
      "mid-corner speed",
      "mid corner speed",
      "faster through corner",
    ],
  },
  {
    outcome: "initial_bite",
    direction: "increase",
    phrases: [
      "more initial bite",
      "more initial grip",
      "more initial steering",
      "sharper turn in",
      "sharper turn-in",
      "sharper on entry",
      "more response on entry",
    ],
  },
  {
    outcome: "initial_bite",
    direction: "decrease",
    phrases: [
      "less initial bite",
      "calm initial",
      "smoother turn in",
      "smoother turn-in",
      "too edgy on entry",
      "too grabby on entry",
    ],
  },
  {
    outcome: "compliance_over_bumps",
    direction: "increase",
    phrases: [
      "better over bumps",
      "more compliance over bumps",
      "more compliant",
      "soaks up bumps",
      "bumps upset the car",
      "car skips over bumps",
      "skipping on bumps",
      "kerbs upset",
      "kerbs unsettle",
      "bumpy track",
    ],
  },
];

export type DetectedIntent = {
  outcome: Outcome;
  direction: OutcomeDirection;
  /** The exact phrase that triggered the match — surfaces for debugging. */
  matchedPhrase: string;
};

/**
 * Detects a catalogued outcome intent in a free-text user message. Returns
 * null when no pattern matches; callers should fall back to the existing
 * keyword-retrieval path for conceptual / diagnostic questions.
 */
export function detectOutcomeIntent(message: string): DetectedIntent | null {
  if (!message || typeof message !== "string") return null;
  const lower = message.toLowerCase();
  for (const pattern of INTENT_PATTERNS) {
    for (const phrase of pattern.phrases) {
      if (lower.includes(phrase)) {
        return {
          outcome: pattern.outcome,
          direction: pattern.direction,
          matchedPhrase: phrase,
        };
      }
    }
  }
  return null;
}
