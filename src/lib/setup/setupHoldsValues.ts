/**
 * "Does this setup actually hold any numbers?" — the test that separates a setup someone filled
 * in from the empty shell every logged run writes automatically.
 *
 * Pure — no Prisma, no `server-only`. The SQL in `getDashboardSetups.ts` asks the same question of
 * the database, and this is the readable statement of the rule it implements; keeping the two in
 * one place is why this file exists separately from its only caller.
 *
 * Measured 2026-08-25 against all 1,617 run-written snapshots, because the threshold looked like a
 * judgement call and turned out not to be one:
 *
 *     0 fields ....... 73        6-20 fields ...... 8
 *     1-5 fields ..... 62       21-50 fields ...... 9
 *                               51+ fields ..... 1465   (91%)
 *
 * The distribution is bimodal with almost nothing between 5 and 51, and — the part that settles it
 * — no real driver's FULLEST setup lands in the 1-5 band. Those near-empty rows all belong to
 * people who also have complete ones, so they are a stray run entry rather than a pattern. Any
 * threshold from 1 to 22 would have produced identical behaviour for every actual user, so the
 * rule is the simplest one that works: more than nothing.
 */

/**
 * True when at least one field carries a value. `null` and `""` are what an untouched field looks
 * like once it has been through JSON; `undefined` cannot survive the round trip but is checked so
 * the function behaves the same on an in-memory object.
 */
export function setupHoldsValues(data: unknown): boolean {
  if (data == null || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.values(data as Record<string, unknown>).some(
    (value) => value !== null && value !== undefined && value !== "",
  );
}
