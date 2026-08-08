/**
 * The one event row shape the Events page passes around, in a module with no Prisma
 * import so the pure derivations (`seasonCadence`, `seasonTimeline`) can be unit-tested
 * without pulling a database client — and, being plain strings and numbers, so it crosses
 * the server/client boundary as-is.
 *
 * Dates are `YYYY-MM-DD` UTC calendar days rather than `Date`s on purpose: events are
 * stored at UTC noon, every calculation on this page is calendar-day arithmetic, and a
 * `Date` would invite a local-timezone getter that shifts a marker by a day for anyone
 * east of GMT.
 */
export type SeasonEventRow = {
  id: string;
  name: string;
  startYmd: string;
  endYmd: string;
  dayCount: number;
  trackId: string | null;
  trackName: string | null;
  trackLocation: string | null;
  /**
   * Upcoming until the END date passes, so a meeting in progress stays booked. This is
   * NOT the retired `Planned` badge, which described whether a LiveRC URL had been
   * pasted and so read `Planned` on a club day raced three months ago.
   */
  status: "booked" | "logged";
  runCount: number;
  bestLapSeconds: number | null;
  /**
   * Event best minus the user's best at that venue as at the day before it. Negative means
   * they went faster than they ever had there. Null when there is no prior visit to beat.
   */
  vsVenueSeconds: number | null;
  /** Holds the best lap at its venue within the current scope — the timeline's yellow mark. */
  isVenueBest: boolean;
};
