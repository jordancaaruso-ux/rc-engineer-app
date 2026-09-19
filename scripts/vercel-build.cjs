/**
 * Vercel / Neon: `prisma migrate deploy` uses a Postgres advisory lock; acquiring it
 * via the pooler can exceed the default 10s timeout (P1002). Prisma documents
 * PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK for environments where advisory locking is
 * problematic; migration history still prevents duplicate applies.
 * @see https://www.prisma.io/docs/orm/reference/environment-variables-reference
 */
const { spawnSync } = require("node:child_process");

/**
 * Neon auto-suspends an idle compute, and the first connection has to wake it. Prisma's
 * PostgreSQL connector defaults to a 5s `connect_timeout`, which a cold start can miss:
 * on 2026-08-03 three consecutive attempts each died at almost exactly 5.03s with P1001
 * while the compute was merely asleep, not unhealthy. Even a *warm* connect on this
 * project takes ~2.5s, so the default left under three seconds of headroom on a good
 * day — the deploy was quietly racing the autosuspend timer and losing at random.
 *
 * Appended by string rather than via `new URL()`: round-tripping a URL re-encodes the
 * password, which would silently corrupt credentials containing reserved characters.
 */
const CONNECT_TIMEOUT_SECONDS = 30;

function withConnectTimeout(url) {
  if (!url || /[?&]connect_timeout=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}connect_timeout=${CONNECT_TIMEOUT_SECONDS}`;
}

const env = {
  ...process.env,
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
};
if (env.DATABASE_URL) env.DATABASE_URL = withConnectTimeout(env.DATABASE_URL);

/** Synchronous pause — this script is a plain command runner, not an async pipeline. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(cmd, { allowFailure = false } = {}) {
  const r = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    env,
    windowsHide: true,
  });
  if (!allowFailure) {
    if (r.status !== 0 && r.status != null) process.exit(r.status);
    if (r.error) throw r.error;
  }
}

/**
 * Retry a command that can fail purely because the database was asleep. The widened
 * timeout above should be enough on its own; this is the belt to its braces, because a
 * failed first attempt still leaves the compute on its way up, so a later try lands warm.
 * Anything that is genuinely broken fails all the same, just later.
 */
function runWithRetry(cmd, { attempts = 3, delayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const r = spawnSync(cmd, { shell: true, stdio: "inherit", env, windowsHide: true });
    if (r.status === 0) return;
    if (attempt === attempts) {
      if (r.error) throw r.error;
      process.exit(r.status ?? 1);
    }
    console.log(
      `\n[vercel-build] "${cmd}" failed (attempt ${attempt}/${attempts}). ` +
        `Retrying in ${delayMs / 1000}s — a suspended Neon compute usually answers once it is awake.\n`
    );
    sleepSync(delayMs);
  }
}

/** Clear P3018 failed state so idempotent SQL can re-apply (e.g. enum already from db push). */
const FAILED_VIDEO_MIGRATION = "20260522120000_video_sector_analysis";
run(
  `npx prisma migrate resolve --rolled-back "${FAILED_VIDEO_MIGRATION}"`,
  { allowFailure: true }
);

/** UTF-8 BOM in migration.sql caused first deploy to fail; allow re-apply after fix. */
const FAILED_TRACK_LOCATION_DISMISSAL_MIGRATION =
  "20260528140000_track_location_prompt_dismissal";
run(
  `npx prisma migrate resolve --rolled-back "${FAILED_TRACK_LOCATION_DISMISSAL_MIGRATION}"`,
  { allowFailure: true }
);

/**
 * 2026-09-19 — two builders, one database. Every push to `beta` is built twice: by the beta project
 * (its production) and by the main project (a preview nobody opens). Both point at the production
 * database, and the advisory lock is off (top of this file), so both ran
 * `20260919120000_tire_type_position` in the same second. The preview won and applied both tyre
 * migrations cleanly; the beta build hit "column already exists" and left a FAILED row, which makes
 * every later `migrate deploy` — beta AND production — stop with P3009. Marking that row rolled back
 * is enough: the winner's row for the same name stays, so nothing is re-applied.
 */
const RACED_TIRE_POSITION_MIGRATION = "20260919120000_tire_type_position";

/**
 * The race itself: the main project's preview of `beta` has no business migrating production — the
 * beta project's own build does that. Narrow on purpose (this one branch, this one case) so every
 * other preview behaves exactly as it did.
 */
const isMainProjectPreviewOfBeta =
  process.env.VERCEL_GIT_COMMIT_REF === "beta" && process.env.VERCEL_ENV !== "production";

if (isMainProjectPreviewOfBeta) {
  console.log("[vercel-build] preview of beta in the main project — leaving migrations to the beta project's build.");
} else {
  run(`npx prisma migrate resolve --rolled-back "${RACED_TIRE_POSITION_MIGRATION}"`, { allowFailure: true });
  runWithRetry("npx prisma migrate deploy");
}
run("node scripts/build-kb-chunk-index.cjs");
run("npx next build");
