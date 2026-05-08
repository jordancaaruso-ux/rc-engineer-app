/**
 * Heals drift between Neon and prisma/migrations: loops `migrate deploy` and
 * - P3009 failed migration: runs prisma/manual-recovery/<name>.sql if present (db execute), then resolve --applied
 * - P3018 duplicate table (42P07): optional recovery SQL, then resolve --applied
 * - P3018 duplicate enum (42710): runs matching manual-recovery SQL if present, then resolve --applied
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- node scripts/reconcile-prisma-migrations.cjs
 */
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Load .env.local via dotenv-cli or export it.");
  process.exit(1);
}

const repoRoot = path.join(__dirname, "..");
process.chdir(repoRoot);

const MAX_ROUNDS = 100;

function recoverySqlRelPosix(name) {
  const full = path.join(repoRoot, "prisma", "manual-recovery", `${name}.sql`);
  return fs.existsSync(full) ? `prisma/manual-recovery/${name}.sql` : null;
}

function runShell(cmd) {
  return spawnSync(cmd, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
    shell: true,
    windowsHide: true,
    cwd: repoRoot,
  });
}

function runShellInherited(cmd) {
  return spawnSync(cmd, {
    env: process.env,
    shell: true,
    stdio: "inherit",
    windowsHide: true,
    cwd: repoRoot,
  });
}

function runMigrateDeploy() {
  return runShell("npx prisma migrate deploy");
}

function runResolveApplied(name) {
  return runShell(`npx prisma migrate resolve --applied ${JSON.stringify(name)}`);
}

function runDbExecute(relPosixPath) {
  return runShell(
    `npx prisma db execute --schema prisma/schema.prisma --file ${JSON.stringify(relPosixPath)}`
  );
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

function looksLikeDuplicateObjectNeedsManualReview(output) {
  return /\b42710\b/.test(output) || /type\s+"[^"]+"\s+already\s+exists/i.test(output);
}

function handleResolveOutput(rr, rout) {
  if (rout) console.log(rout);
  if (/\bP3008\b/.test(rout) && /already recorded as applied/i.test(rout)) {
    console.log("(already recorded as applied — continuing)");
    return true;
  }
  return rr.status === 0;
}

for (let round = 0; round < MAX_ROUNDS; round++) {
  console.log(`\n--- migrate deploy (round ${round + 1}) ---\n`);
  const r = runMigrateDeploy();
  const out = `${r.stdout || ""}${r.stderr || ""}`;

  if (r.status === 0) {
    console.log(out);
    console.log("\n✓ prisma migrate deploy completed successfully.");
    const st = runShellInherited("npx prisma migrate status");
    process.exit(st.status ?? 0);
  }

  console.log(out);

  if (/\bP3009\b/.test(out)) {
    const name = extractP3009MigrationName(out);
    if (!name) {
      console.error("\n✗ P3009: could not parse migration name.");
      process.exit(1);
    }
    const rel = recoverySqlRelPosix(name);
    if (!rel) {
      console.error(
        `\n✗ P3009 on "${name}": no prisma/manual-recovery/${name}.sql\n` +
          "Add that file (idempotent SQL for this migration) or fix Neon manually, then re-run.\n" +
          `Try: npx prisma migrate resolve --applied ${name}  (only if DB already matches the migration.)`
      );
      process.exit(1);
    }
    console.log(`\n→ P3009: executing ${rel} …`);
    const ex = runDbExecute(rel);
    const exOut = `${ex.stdout || ""}${ex.stderr || ""}`;
    if (exOut) console.log(exOut);
    if (ex.status !== 0) {
      console.error("\n✗ prisma db execute failed (fix SQL or Neon state).");
      process.exit(ex.status ?? 1);
    }
    console.log(`→ P3009: marking applied: ${name}`);
    const rr = runResolveApplied(name);
    const rout = `${rr.stdout || ""}${rr.stderr || ""}`;
    if (!handleResolveOutput(rr, rout)) {
      console.error("\n✗ migrate resolve --applied failed after db execute.");
      process.exit(rr.status ?? 1);
    }
    continue;
  }

  if (/\bP3018\b/.test(out) && looksLikeDuplicateObjectNeedsManualReview(out)) {
    const name = extractP3018MigrationName(out);
    if (!name) {
      console.error("\n✗ P3018 (duplicate type): could not parse migration name.");
      process.exit(1);
    }
    const rel = recoverySqlRelPosix(name);
    if (!rel) {
      console.error(
        "\n✗ P3018: duplicate type/object — need prisma/manual-recovery/" +
          name +
          ".sql with idempotent ALTER/CREATE, then re-run this script."
      );
      process.exit(1);
    }
    console.log(`\n→ P3018 (42710): executing ${rel} …`);
    const ex = runDbExecute(rel);
    const exOut = `${ex.stdout || ""}${ex.stderr || ""}`;
    if (exOut) console.log(exOut);
    if (ex.status !== 0) {
      console.error("\n✗ prisma db execute failed.");
      process.exit(ex.status ?? 1);
    }
    console.log(`→ marking applied: ${name}`);
    const rr = runResolveApplied(name);
    const rout = `${rr.stdout || ""}${rr.stderr || ""}`;
    if (!handleResolveOutput(rr, rout)) {
      process.exit(rr.status ?? 1);
    }
    continue;
  }

  if (/\bP3018\b/.test(out) && looksLikeSafeAlreadyExistsConflict(out)) {
    const name = extractP3018MigrationName(out);
    if (!name) {
      console.error("\n✗ P3018 but could not parse migration name.");
      process.exit(1);
    }
    const rel = recoverySqlRelPosix(name);
    if (rel) {
      console.log(`\n→ P3018 (42P07): running recovery file ${rel} …`);
      const ex = runDbExecute(rel);
      const exOut = `${ex.stdout || ""}${ex.stderr || ""}`;
      if (exOut) console.log(exOut);
      if (ex.status !== 0) {
        console.error("\n✗ db execute failed; fix SQL or DB state.");
        process.exit(ex.status ?? 1);
      }
    }
    console.log(`\n→ P3018: marking applied: ${name}`);
    const rr = runResolveApplied(name);
    const rout = `${rr.stdout || ""}${rr.stderr || ""}`;
    if (!handleResolveOutput(rr, rout)) {
      process.exit(rr.status ?? 1);
    }
    continue;
  }

  console.error("\n✗ migrate deploy failed (unhandled error). See output above.");
  process.exit(r.status ?? 1);
}

console.error(`\n✗ Gave up after ${MAX_ROUNDS} rounds.`);
process.exit(1);
