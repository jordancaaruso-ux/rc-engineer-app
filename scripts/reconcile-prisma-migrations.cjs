/**
 * Reconciles _prisma_migrations with a database whose objects were often created
 * earlier (db push, partial deploys, manual SQL) so `migrate deploy` hits
 * duplicate-table style failures (42P07). For each such failure, runs
 * `prisma migrate resolve --applied <name>` and retries deploy until clean exit.
 *
 * Does NOT fix P3009 "failed migration" rows — those need Neon repair + one manual
 * resolve first (see prisma/manual-recovery/).
 *
 * Usage (production URL in env):
 *   npx dotenv-cli -e .env.local -- node scripts/reconcile-prisma-migrations.cjs
 *
 * Or:
 *   $env:DATABASE_URL="postgresql://..."   # PowerShell
 *   node scripts/reconcile-prisma-migrations.cjs
 */
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Load .env.local via dotenv-cli or export it.");
  process.exit(1);
}

const MAX_ROUNDS = 80;

function runShell(cmd) {
  return spawnSync(cmd, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
    shell: true,
    windowsHide: true,
  });
}

function runShellInherited(cmd) {
  return spawnSync(cmd, {
    env: process.env,
    shell: true,
    stdio: "inherit",
    windowsHide: true,
  });
}

function runMigrateDeploy() {
  return runShell("npx prisma migrate deploy");
}

function runResolveApplied(name) {
  return runShell(`npx prisma migrate resolve --applied ${JSON.stringify(name)}`);
}

function extractP3018MigrationName(output) {
  const m = output.match(/Migration name:\s*(\S+)/);
  return m ? m[1] : null;
}

function extractP3009MigrationName(output) {
  const m = output.match(/The `([^`]+)` migration/);
  return m ? m[1] : null;
}

function looksLikeSafeAlreadyExistsConflict(output) {
  if (/\b42P07\b/.test(output)) return true;
  if (/ERROR:\s*relation\s+"[^"]+"\s+already\s+exists/i.test(output)) return true;
  return false;
}

/** Enum / duplicate_object: may be only partially applied — require manual SQL + resolve. */
function looksLikeDuplicateObjectNeedsManualReview(output) {
  return /\b42710\b/.test(output) || /type\s+"[^"]+"\s+already\s+exists/i.test(output);
}

for (let round = 0; round < MAX_ROUNDS; round++) {
  console.log(`\n--- migrate deploy (round ${round + 1}) ---\n`);
  const r = runMigrateDeploy();
  const out = `${r.stdout || ""}${r.stderr || ""}`;

  if (r.status === 0) {
    console.log(out);
    console.log("\n✓ prisma migrate deploy completed successfully.");
    const st = runShellInherited("npx prisma migrate status");
    if (st.status !== 0) {
      process.exit(st.status ?? 1);
    }
    process.exit(0);
  }

  console.log(out);

  if (/\bP3009\b/.test(out)) {
    const name = extractP3009MigrationName(out);
    console.error(
      "\n✗ P3009: a migration is marked FAILED in _prisma_migrations. Auto-reconcile stops here.\n" +
        "Fix the database for that migration (Neon SQL / manual-recovery), then run:\n" +
        `  npx prisma migrate resolve --applied ${name || "<migration_name>"}\n` +
        "or --rolled-back if nothing from that migration applied.\n" +
        "Then re-run: node scripts/reconcile-prisma-migrations.cjs"
    );
    process.exit(1);
  }

  if (/\bP3018\b/.test(out) && looksLikeDuplicateObjectNeedsManualReview(out)) {
    console.error(
      "\n✗ P3018: duplicate type/object (e.g. 42710). Do not auto-resolve — the rest of this migration may not have run.\n" +
        "Verify columns/indexes from that migration in Neon, run any missing SQL from prisma/migrations/<name>/migration.sql,\n" +
        "then: npx prisma migrate resolve --applied <that_migration_folder_name>\n" +
        "Re-run this script after."
    );
    const name = extractP3018MigrationName(out);
    if (name) console.error(`Migration: ${name}`);
    process.exit(1);
  }

  if (/\bP3018\b/.test(out) && looksLikeSafeAlreadyExistsConflict(out)) {
    const name = extractP3018MigrationName(out);
    if (!name) {
      console.error("\n✗ P3018 but could not parse migration name. Fix manually.");
      process.exit(1);
    }
    console.log(`\n→ Marking already-present schema as applied: ${name}`);
    const rr = runResolveApplied(name);
    const rout = `${rr.stdout || ""}${rr.stderr || ""}`;
    if (rout) console.log(rout);
    if (/\bP3008\b/.test(rout) && /already recorded as applied/i.test(rout)) {
      console.log("(already applied in history — continuing)");
      continue;
    }
    if (rr.status !== 0) {
      console.error("\n✗ migrate resolve failed.");
      process.exit(rr.status ?? 1);
    }
    continue;
  }

  console.error("\n✗ migrate deploy failed (not a handled already-exists P3018). Fix manually.");
  process.exit(r.status ?? 1);
}

console.error(`\n✗ Gave up after ${MAX_ROUNDS} rounds.`);
process.exit(1);
