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

runWithRetry("npx prisma migrate deploy");
run("node scripts/build-kb-chunk-index.cjs");
run("npx next build");
