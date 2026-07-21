#!/usr/bin/env node
// PreToolUse guard for hard-rule #2: never `prisma db push` against production.
// We can't reliably tell prod from dev by reading the command (and on this machine the
// local .env.local sometimes points at the real prod DB), so instead of silently allowing
// or hard-denying, we force a conscious "ask" on ANY db-push form. Confirm the target is a
// throwaway Neon branch, never prod, before approving.
"use strict";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let cmd = "";
  try {
    cmd = (JSON.parse(raw || "{}").tool_input || {}).command || "";
  } catch {
    process.exit(0); // malformed input → don't interfere
  }

  // Match `prisma db push` (npx/pnpm/yarn/direct) and the `db:push` npm script.
  const isDbPush = /\bprisma\s+db\s+push\b/.test(cmd) || /\bdb:push\b/.test(cmd);
  if (!isDbPush) process.exit(0);

  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "`prisma db push` detected. It skips _prisma_migrations and breaks Vercel's " +
        "migrate deploy (P3009) if it ever touches prod. Confirm DATABASE_URL points at a " +
        "throwaway Neon branch — NOT production — before approving. Prod schema changes must " +
        "be a committed migration + `migrate deploy`.",
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
