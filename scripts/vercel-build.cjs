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

function run(cmd) {
  const r = spawnSync(cmd, {
    shell: true,
    stdio: "inherit",
    env,
    windowsHide: true,
  });
  if (r.status !== 0 && r.status != null) process.exit(r.status);
  if (r.error) throw r.error;
}

run("npx prisma migrate deploy");
run("npx next build");
