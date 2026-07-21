#!/usr/bin/env node
// PreToolUse guard for hard-rule #1: the founder-approved Engineer KB is quoted to drivers as
// ground truth. Force an "ask" on any Edit/Write to a locked KB file so a stray edit can't land
// silently. Drafts (content/vehicle-dynamics/drafts/**) are open — allowed without prompting.
"use strict";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let fp = "";
  try {
    fp = (JSON.parse(raw || "{}").tool_input || {}).file_path || "";
  } catch {
    process.exit(0);
  }

  const p = fp.replace(/\\/g, "/"); // normalize Windows separators
  const inKb = /\/content\/vehicle-dynamics\//.test(p) || /^content\/vehicle-dynamics\//.test(p);
  const isDraft = /\/content\/vehicle-dynamics\/drafts\//.test(p) || /^content\/vehicle-dynamics\/drafts\//.test(p);
  const isCatalog = /\/parameterEffects\/catalog\.ts$/.test(p) || /parameterEffects\/catalog\.ts$/.test(p);

  const locked = (inKb && !isDraft) || isCatalog;
  if (!locked) process.exit(0);

  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason:
        "This is a locked Engineer KB file — the Engineer quotes it to drivers as ground truth. " +
        "Only edit it if the user's most recent message explicitly asked for KB content changes " +
        "to THIS file. Otherwise cancel and propose the diff in chat first. (Drafts under " +
        "content/vehicle-dynamics/drafts/ are open and not gated.)",
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
