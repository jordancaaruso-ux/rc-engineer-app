import { createHash } from "node:crypto";

/**
 * Which Engineer build produced an answer. Stamped into every rating snapshot so a
 * batch of ratings can be pulled out on its own after a change:
 * `npm run engineer:export-feedback -- --prompt-version <version>`.
 *
 * Bump the label when you change Engineer behaviour you want to measure separately —
 * approving a KB draft, re-tiering the KB, changing retrieval. Edits to the prompt text
 * itself move the fingerprint even when the label is left alone.
 */
export const ENGINEER_PROMPT_LABEL = "2026-08-05-minimal";

export function engineerPromptFingerprint(promptText: string): string {
  return createHash("sha256").update(promptText).digest("hex").slice(0, 8);
}

export function formatEngineerPromptVersion(label: string, promptText: string): string {
  return `${label}+${engineerPromptFingerprint(promptText)}`;
}
