/** Payload stored in `EngineerBetweenRunHint.payloadJson` and returned to clients. */

export type BetweenRunHintSignal =
  | "lap_regressed"
  | "lap_improved"
  | "feel_worse"
  | "feel_better"
  | "meaningful_setup_change"
  | "low_lap_data";

export type BetweenRunHintScopeV1 = {
  eventId: string | null;
  eventLabel: string | null;
  carId: string;
  carLabel: string;
  trackId: string | null;
  trackLabel: string | null;
};

export type BetweenRunHintPayloadV1 = {
  version: 1;
  scope: BetweenRunHintScopeV1;
  basedOnRunIds: { primary: string; reference: string | null };
  signals: BetweenRunHintSignal[];
  headline: string;
  bullets: string[];
  /** Non-empty when regression aligns with setup changes; otherwise null. */
  avoidRepeating: string | null;
  sourcesNote: string;
  /** Deep link to Engineer with this pair pre-selected. */
  engineerHref: string;
};
