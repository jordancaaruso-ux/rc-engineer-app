#!/usr/bin/env node
/**
 * Stop hook: warn when work is sitting uncommitted anywhere in this repo.
 *
 * Jordan runs several Claude sessions at once across git worktrees. That's fine — what isn't
 * fine is uncommitted work sitting in a worktree nobody is looking at. On 2026-07-27 three
 * worktrees held 55 uncommitted files between them, invisible from the main checkout and not
 * covered by any backup, because `git bundle` only captures committed objects.
 *
 * This never blocks. It prints one line per dirty tree at the end of a turn, so loose work
 * surfaces the same day instead of a week later.
 */

const { execFileSync } = require("node:child_process");
const path = require("node:path");

/** Dirty-file count is noise below this — a build artifact or two isn't worth a warning. */
const QUIET_THRESHOLD = 1;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
}

/** Every worktree attached to this repo, main checkout included. */
function worktreePaths() {
  const out = git(["worktree", "list", "--porcelain"], process.cwd());
  return out
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
}

function dirtyCount(dir) {
  // --porcelain counts staged, unstaged and untracked alike; all three are "not committed".
  const out = git(["status", "--porcelain"], dir);
  return out.split(/\r?\n/).filter((l) => l.trim()).length;
}

function currentBranch(dir) {
  try {
    return git(["branch", "--show-current"], dir).trim() || "detached HEAD";
  } catch {
    return "unknown";
  }
}

try {
  const dirty = [];
  for (const dir of worktreePaths()) {
    let count;
    try {
      count = dirtyCount(dir);
    } catch {
      continue; // Worktree pruned or on a disconnected drive — not this hook's problem.
    }
    if (count >= QUIET_THRESHOLD) {
      dirty.push({ name: path.basename(dir), branch: currentBranch(dir), count });
    }
  }

  if (dirty.length === 0) process.exit(0);

  const total = dirty.reduce((n, d) => n + d.count, 0);
  const lines = dirty.map((d) => `  ${d.name} (${d.branch}): ${d.count} uncommitted`);
  const message = `Uncommitted work — ${total} file(s) across ${dirty.length} tree(s):\n${lines.join("\n")}`;

  process.stdout.write(JSON.stringify({ systemMessage: message }));
} catch {
  // Not a git repo, git missing, anything else — stay silent. A warning hook must never
  // become the reason a turn fails.
  process.exit(0);
}
