/**
 * The demo season's clock (MONETISATION_NORTH_STAR.md Phase 3).
 *
 * The demo account is a copy of the founder's real season, and `seed-demo-account.ts` copies
 * every row's dates verbatim. That was fine on the day it was seeded and quietly fatal a month
 * later: the app is full of rolling-window reads ("runs in the last 30 days", "how you're
 * going", the day verdict), and a frozen season ages out of all of them at once. Measured on
 * production 2026-08-25 — a snapshot ending 19 July was showing a visitor `Runs 30d 0`,
 * `Active days 0`, `Best streak 0d` and "No runs in the last 30 days" on the one screen whose
 * whole job is to make the app look alive.
 *
 * Re-seeding does NOT fix it. The window is `now - months`, but the newest row it can copy is
 * the founder's newest real run, so a re-seed lands on the same ending. The season has to
 * MOVE instead: add one delta to every date the demo owns, so the whole run of events keeps
 * its order and its spacing and simply sits later in the calendar.
 *
 * Pure module — no Prisma, no `server-only`, no env at module scope. The SQL that applies a
 * delta lives in `applyDemoDateShift.ts`; the tests (`npm run test:demo`) re-derive the table
 * manifest below straight from schema.prisma so a new DateTime column can't silently escape
 * the shift.
 */

/** How far behind today the demo's newest run should sit after a shift. */
export const DEMO_RECENCY_LAG_DAYS = 2;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Don't write for less than this. The refresh runs on a schedule, and a season that jitters by
 * a few hours every night buys nothing — but it does churn every row and bust every cache.
 * Half a day means a nightly job does exactly one useful shift per day.
 */
export const DEMO_SHIFT_MIN_MS = 12 * 60 * 60 * 1000;

/**
 * Milliseconds to add to every demo date so the newest run lands `lagDays` before `now`.
 *
 * Deliberately signed: if a re-seed ever pulls in runs NEWER than the anchor (the founder
 * raced yesterday), this returns a negative delta and pushes the season back, rather than
 * leaving runs sitting in the future where "last 30 days" counts them and the day verdict
 * tries to reason about a session that hasn't happened.
 */
export function computeDemoShiftMs(input: {
  newestRunAt: Date | null;
  now: Date;
  lagDays?: number;
}): number {
  const { newestRunAt, now } = input;
  if (!newestRunAt) return 0;
  const lagDays = input.lagDays ?? DEMO_RECENCY_LAG_DAYS;
  const target = now.getTime() - lagDays * MS_PER_DAY;
  return target - newestRunAt.getTime();
}

/** Is this delta worth a write? */
export function shouldApplyDemoShift(deltaMs: number): boolean {
  return Math.abs(deltaMs) >= DEMO_SHIFT_MIN_MS;
}

/** A settled thread sits this long after the run it is about — long enough to read as "after". */
export const DEMO_THREAD_AFTER_RUN_MS = 2 * 60 * 60 * 1000;

/**
 * Where one Engineer conversation lands, as a delta for that thread and its messages.
 *
 * Needed because the season anchor is the newest RUN, and conversations are not bound to the run
 * timeline. Measured on the real source account: the founder stopped racing on 19 July and kept
 * asking the Engineer questions until 20 August, so his newest thread is **32 days newer than his
 * newest run**. Move everything by the run delta and those conversations land a month in the
 * FUTURE — the demo's history rendered "in 24 days" against today, which is the most obvious
 * possible tell that the data is manufactured.
 *
 * Two rules, in order:
 *
 *  1. **Nothing in the future.** The thread set gets its own uniform delta, anchored so the newest
 *     conversation sits just behind now. Uniform keeps the gaps between conversations intact.
 *  2. **A conversation about a run happens after that run.** Rule 1 alone can pull an anchored
 *     thread back before the run it discusses (its run moved by the larger season delta), which is
 *     a worse kind of wrong than a future date — it is wrong in a way that survives a second look.
 *     So an anchored thread is pushed forward to sit just after its run when it would otherwise
 *     precede it.
 *
 * Rule 2 can only push later, never earlier, and its ceiling is the newest run — which is already
 * `DEMO_RECENCY_LAG_DAYS` behind today. So it can never reintroduce a future date.
 *
 * Seed-time only. Once settled, the nightly refresh moves threads with everything else by the one
 * uniform delta, which preserves all of this.
 */
export function placeDemoThread(input: {
  /** The thread's current timestamp, before any shift. */
  threadAt: Date;
  /** The uniform delta for the thread SET (rule 1). */
  threadSetDeltaMs: number;
  /** Where the run it is about has already been moved to, or null if it is a general question. */
  anchorRunAt: Date | null;
  minGapAfterRunMs?: number;
}): number {
  const { threadAt, threadSetDeltaMs, anchorRunAt } = input;
  const gap = input.minGapAfterRunMs ?? DEMO_THREAD_AFTER_RUN_MS;
  const landed = threadAt.getTime() + threadSetDeltaMs;
  if (!anchorRunAt) return threadSetDeltaMs;
  const earliest = anchorRunAt.getTime() + gap;
  if (landed >= earliest) return threadSetDeltaMs;
  return threadSetDeltaMs + (earliest - landed);
}

/*
 * Only the COLUMNS move, never dates nested inside the JSON payloads (`lapSession`,
 * `parsedPayload`). Those are ISO strings of raw parser output, not anything the UI groups or
 * sorts by, and rewriting strings that merely look like dates inside an arbitrary blob is how
 * you corrupt a lap import. Every rolling window in the app reads the columns.
 */

/**
 * How a table's rows are recognised as the demo's own.
 *  - `user`   — the row carries `userId` directly.
 *  - `run`    — child of a demo Run (`runId`).
 *  - `thread` — child of a demo EngineerChatThread (`threadId`).
 */
export type DemoDateScope = "user" | "run" | "thread";

export type DemoDateTable = {
  /** Postgres table name. Prisma model names ARE the table names here — no `@@map` in the schema. */
  table: string;
  scope: DemoDateScope;
  /** Every DateTime column on that table. Verified against schema.prisma by the unit test. */
  columns: string[];
};

/**
 * Every table the demo account owns rows in that carries a date.
 *
 * `updatedAt` columns are shifted too. Prisma would stamp them `now()` on a write, but these
 * updates are raw SQL, and a season whose rows all claim to have been touched today while
 * claiming to be from six weeks ago is exactly the kind of detail that makes a demo smell
 * synthetic to someone reading closely.
 *
 * NOT here on purpose: `User` (the demo account's own signup date is not part of the season),
 * `Subscription` (a fake row ending 2099 — shifting it is meaningless), and `RunImportedLap`
 * (individual laps carry lap times, not timestamps).
 */
export const DEMO_DATE_TABLES: readonly DemoDateTable[] = [
  {
    table: "Run",
    scope: "user",
    columns: [
      "createdAt",
      "renderedSetupPdfGeneratedAt",
      "sessionCompletedAt",
      "loggingCompletedAt",
      "incompleteLoggingPromptDismissedAt",
      "lapImportPromptDismissedAt",
      "sortAt",
      "engineerSummaryComputedAt",
      "conditionsObservedAt",
    ],
  },
  { table: "Track", scope: "user", columns: ["locationMarkedAt", "createdAt", "verifiedAt"] },
  { table: "TrackLayout", scope: "user", columns: ["createdAt", "updatedAt"] },
  { table: "Car", scope: "user", columns: ["createdAt"] },
  { table: "TireSet", scope: "user", columns: ["createdAt", "archivedAt"] },
  { table: "SetupSnapshot", scope: "user", columns: ["createdAt", "renderedSetupPdfGeneratedAt"] },
  {
    table: "ImportedLapTimeSession",
    scope: "user",
    columns: ["createdAt", "updatedAt", "sessionCompletedAt", "detectionPromptDismissedAt"],
  },
  { table: "EngineerBetweenRunHint", scope: "user", columns: ["createdAt", "updatedAt"] },
  { table: "EngineerDashboardSuggestion", scope: "user", columns: ["createdAt", "updatedAt"] },
  { table: "ActionItem", scope: "user", columns: ["createdAt", "updatedAt"] },
  { table: "EventParticipation", scope: "user", columns: ["createdAt", "pinnedAt"] },
  { table: "EngineerChatThread", scope: "user", columns: ["createdAt", "updatedAt"] },
  { table: "AppSetting", scope: "user", columns: ["createdAt", "updatedAt"] },
  {
    // Only reachable once the seed CLONES events for the demo instead of pointing its runs at
    // the founder's global ones. Until then this table has no demo-owned rows and the update
    // is a no-op — which is the correct behaviour either way: shifting a shared meeting would
    // move it under every real driver who raced it.
    table: "Event",
    scope: "user",
    columns: [
      "startDate",
      "endDate",
      "createdAt",
      "practiceLastSeenSessionCompletedAt",
      "resultsLastSeenSessionCompletedAt",
    ],
  },
  { table: "RunImportedLapSet", scope: "run", columns: ["createdAt", "sessionCompletedAt"] },
  { table: "EngineerChatMessage", scope: "thread", columns: ["createdAt"] },
] as const;
