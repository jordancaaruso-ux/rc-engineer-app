/**
 * Vercel / Neon: `prisma migrate deploy` uses a Postgres advisory lock; acquiring it
 * via the pooler can exceed the default 10s timeout (P1002). Prisma documents
 * PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK for environments where advisory locking is
 * problematic; migration history still prevents duplicate applies.
 * @see https://www.prisma.io/docs/orm/reference/environment-variables-reference
 */
const { spawnSync } = require("node:child_process");

const env = {
  ...process.env,
  PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
};

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

run("npx prisma migrate deploy");
run("node scripts/build-kb-chunk-index.cjs");
run("npx next build");
