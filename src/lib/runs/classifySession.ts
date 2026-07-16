/**
 * Classify a timing-provider round/heat name (LiveRC `sessionHint.name`, MyRCM
 * session label) into the app's meeting-session model.
 *
 * Detection is by the name string only (the parser exposes no session-type enum).
 * Product decisions baked in (founder interview, 2026-07-16):
 *  - Mains carry an A/B/C letter; **legs collapse** ("A-Main Leg 2" → "A Main").
 *  - Only a **confident** match may overwrite what the driver picked on page 1;
 *    ambiguous names ("Round 1") return `confident: false` and are left alone.
 *  - **Seeding is not surfaced** — a "Seeding" round classifies as QUALIFYING.
 *
 * This is a pure classifier; wiring it into the import flow (correct-if-wrong)
 * lives at the call site.
 */

import type { MeetingSessionType } from "@/lib/runSession";

export type SessionClassification = {
  /** Null when nothing matched. RACE covers all mains (A/B/C). Never SEEDING (folded into QUALIFYING). */
  meetingSessionType: MeetingSessionType | null;
  /** Uppercase A–F for a main; undefined otherwise. */
  mainLetter?: string;
  /** Display label for the session, legs collapsed (e.g. "A Main", "Qualifier 3"). */
  sessionLabel: string;
  /** True only when the name matched a known, unambiguous pattern. Gate corrections on this. */
  confident: boolean;
};

const MAIN_WITH_LETTER = /\b([a-f])[\s-]*main\b/; // "A Main", "A-Main"
const MAIN_LETTER_AFTER = /\bmain[\s-]*([a-f])\b/; // "Main C"
const BARE_MAIN = /\bmain\b|\bfeature\b/; // "Main Event", "Feature"
const QUAL = /\bqual\w*\b|\bseed\w*\b|\bbump\b|\blcq\b|\blast\s*chance\b/; // qualifier/qualifying/seeding/bump/LCQ
const QUAL_SHORT = /\bq[\s-]?\d+\b/; // "Q2", "Q 2"
const AMBIGUOUS_ROUND = /\bround\s*\d+\b/i; // bare "Round 1" — could be practice or qual

export function classifySession(rawName: string | null | undefined): SessionClassification {
  const name = (rawName ?? "").trim();
  const n = name.toLowerCase();

  if (!n) {
    return { meetingSessionType: null, sessionLabel: "", confident: false };
  }

  // Practice — strongest, most explicit keyword.
  if (/\bpractice\b/.test(n)) {
    return { meetingSessionType: "PRACTICE", sessionLabel: name, confident: true };
  }

  // Mains (finals). Letter first; legs are ignored for identity.
  const letterMatch = n.match(MAIN_WITH_LETTER) ?? n.match(MAIN_LETTER_AFTER);
  if (letterMatch) {
    const letter = letterMatch[1].toUpperCase();
    return { meetingSessionType: "RACE", mainLetter: letter, sessionLabel: `${letter} Main`, confident: true };
  }
  if (BARE_MAIN.test(n)) {
    return { meetingSessionType: "RACE", mainLetter: "A", sessionLabel: "A Main", confident: true };
  }

  // Qualifying (seeding/bump/LCQ fold in here — Seeding is intentionally not surfaced).
  if (QUAL.test(n) || QUAL_SHORT.test(n)) {
    return { meetingSessionType: "QUALIFYING", sessionLabel: name, confident: true };
  }

  // Ambiguous bare "Round N" — a real timing label but not decisively qual vs practice.
  if (AMBIGUOUS_ROUND.test(n) || /^\s*r\d+/i.test(n)) {
    return { meetingSessionType: "QUALIFYING", sessionLabel: name, confident: false };
  }

  return { meetingSessionType: null, sessionLabel: name, confident: false };
}

/**
 * Apply a classification to a run's session fields, but only overwrite the driver's
 * existing pick when the match is confident. Returns the fields to set (or the
 * originals unchanged). Legs stay collapsed via `classification.sessionLabel`.
 */
export function applySessionClassification(
  classification: SessionClassification,
  current: { meetingSessionType?: string | null; sessionLabel?: string | null },
): { meetingSessionType: string | null; sessionLabel: string | null; changed: boolean } {
  if (!classification.confident || !classification.meetingSessionType) {
    return {
      meetingSessionType: current.meetingSessionType ?? null,
      sessionLabel: current.sessionLabel ?? null,
      changed: false,
    };
  }
  const changed =
    (current.meetingSessionType ?? null) !== classification.meetingSessionType ||
    (current.sessionLabel ?? null) !== classification.sessionLabel;
  return {
    meetingSessionType: classification.meetingSessionType,
    sessionLabel: classification.sessionLabel,
    changed,
  };
}
