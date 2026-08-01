#!/usr/bin/env node
// PreToolUse guard: hard-block shell commands that can mutate the production database or
// run the Vercel deploy pipeline locally.
//
// Why a hook and not just a `permissions.deny` rule: deny rules match the command string
// shape, so `sh -c "..."`, `a && b`, and `$(...)` composition slip past them. This reads the
// whole command line, so composition doesn't help.
//
// Context that makes this necessary: every `db:*` script in package.json hardcodes
// `dotenv-cli -e .env.local`, and .env.local has historically pointed at the live database.
// So these commands do NOT need a flag to reach prod — reaching prod is their default.
//
// Repair tooling stays open on purpose: `db:migrate:reconcile` and `migrate resolve` are the
// sanctioned way out of drift (AGENTS.md hard rule #2), so they are not matched here.
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
  if (!cmd) process.exit(0);

  // Match against what actually EXECUTES, not free text the command merely carries.
  // A commit message or doc that mentions `db:push` is prose, not a database write —
  // without this, writing about the guard trips the guard.
  // Only commands that consume stdin as PROSE get their heredoc stripped. For anything else
  // — `bash <<EOF`, `sh <<EOF`, `node <<EOF` — the heredoc body IS the program, so stripping
  // it would be a bypass. Whitelist, not blacklist: unknown commands stay strict.
  const prosePipe = /\bgit\s+(commit|tag|notes|merge)\b|\bgh\s+(pr|issue|release)\b/.test(cmd);

  const executable = cmd
    // heredoc bodies: <<EOF / <<'EOF' / <<-"EOF" ... up to the closing delimiter
    .replace(
      /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm,
      (m) => (prosePipe ? " " : m),
    )
    // message arguments: -m "..." | -m '...' | --message="..."
    // Deliberately NOT stripping all quoted text — `sh -c 'npm run db:push'` must still be
    // caught, so only an explicit message flag is treated as prose.
    .replace(/(^|\s)(-m|--message)(=|\s+)(['"])[\s\S]*?\4/g, " ");

  /** [pattern, why] — first match wins. */
  const BLOCKED = [
    [
      /\bprisma\s+db\s+push\b/,
      "`prisma db push` skips _prisma_migrations and breaks Vercel's `migrate deploy` with a P3009 loop.",
    ],
    [
      /\bnpm\s+run\s+db:push\b|\bdb:push\b/,
      "`db:push` runs `prisma db push` against whatever .env.local points at.",
    ],
    [
      /\bprisma\s+migrate\s+deploy\b/,
      "`migrate deploy` applies migrations to the target DB. Prod migrations are Vercel's job, not a local run.",
    ],
    [
      /\bnpm\s+run\s+db:migrate:deploy\b/,
      "`db:migrate:deploy` applies migrations to whatever .env.local points at.",
    ],
    [
      /\bnpm\s+run\s+db:seed\b|\bprisma\s+db\s+seed\b/,
      "Seeding writes rows. Against the live DB that corrupts real user data.",
    ],
    [
      /\bnpm\s+run\s+build\b/,
      "`npm run build` is the Vercel pipeline (scripts/vercel-build.cjs) — it runs `prisma migrate deploy` first. For a local production build use `npx next build`.",
    ],
  ];

  const hit = BLOCKED.find(([re]) => re.test(executable));
  if (!hit) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Blocked: ${hit[1]} ` +
          "This is denied at the harness level because it is irreversible against production. " +
          "If you genuinely need it, point DATABASE_URL at a throwaway Neon branch and tell " +
          "Jordan what you are about to run — do not try to route around this hook.",
      },
    }),
  );
  process.exit(0);
});
