#!/usr/bin/env node
// PreToolUse guard for hard-rule #1: the founder-approved Engineer KB is quoted to drivers as
// ground truth. Force an "ask" on any write to a locked KB file so a stray edit can't land
// silently. Drafts (content/vehicle-dynamics/drafts/**) are open — allowed without prompting.
//
// Covers two tool shapes:
//   Edit|Write|MultiEdit → tool_input.file_path
//   Bash                 → tool_input.command  (a redirect, tee, or sed -i writes the same
//                          file without ever touching the Edit tool; the old Edit-only
//                          matcher missed that entirely)
//
// Decision is "ask", not "deny", on purpose: AGENTS.md permits KB edits when Jordan's most
// recent message names the file. "ask" makes that a conscious confirmation instead of a
// silent write, and still lets a legitimate approved edit through.
"use strict";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = {};
  try {
    input = JSON.parse(raw || "{}").tool_input || {};
  } catch {
    process.exit(0);
  }

  const ask = (reason) => {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: reason,
        },
      }),
    );
    process.exit(0);
  };

  const REASON =
    "This is a locked Engineer KB file — the Engineer quotes it to drivers as ground truth. " +
    "Only edit it if the user's most recent message explicitly asked for KB content changes " +
    "to THIS file. Otherwise cancel and propose the diff in chat first. (Drafts under " +
    "content/vehicle-dynamics/drafts/ are open and not gated.)";

  /** Locked = top-level KB prose, or the parameter-effects catalog. Drafts are open. */
  function isLocked(p) {
    const inKb = /(^|\/)content\/vehicle-dynamics\//.test(p);
    const isDraft = /(^|\/)content\/vehicle-dynamics\/drafts\//.test(p);
    const isCatalog = /(^|\/)parameterEffects\/catalog\.ts$/.test(p);
    return (inKb && !isDraft) || isCatalog;
  }

  // --- Edit / Write / MultiEdit -------------------------------------------------
  const fp = (input.file_path || "").replace(/\\/g, "/");
  if (fp && isLocked(fp)) ask(REASON);

  // --- Bash ---------------------------------------------------------------------
  const cmd = (input.command || "").replace(/\\/g, "/");
  if (cmd) {
    // Only flag when a locked path is combined with something that can actually write.
    // Reading (grep/cat/rg) a locked file is fine and must not prompt.
    const mentionsLocked = /content\/vehicle-dynamics\/(?!drafts\/)[^\s"';|&]+/.test(cmd)
      || /parameterEffects\/catalog\.ts/.test(cmd);
    const writes =
      />>?/.test(cmd) ||
      /\btee\b/.test(cmd) ||
      /\bsed\b[^|]*\s-i\b/.test(cmd) ||
      /\b(cp|mv|rm|truncate|dd|install)\b/.test(cmd) ||
      /\bSet-Content\b|\bAdd-Content\b|\bOut-File\b/i.test(cmd) ||
      /\b(python|node|perl|ruby)\b[^|]*\b(open|writeFile|writeFileSync)\b/.test(cmd);
    if (mentionsLocked && writes) ask(REASON);
  }

  process.exit(0);
});
