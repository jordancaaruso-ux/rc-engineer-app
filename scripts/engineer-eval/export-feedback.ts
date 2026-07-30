/**
 * Export in-app Engineer ratings → docs/engineer-feedback/inbox.{jsonl,md}
 *
 * Run: npm run engineer:export-feedback
 * Only the batch you care about:
 *   npm run engineer:export-feedback -- --limit 4
 *   npm run engineer:export-feedback -- --since today
 *   npm run engineer:export-feedback -- --prompt-version 2026-07-30+1a2b3c4d
 */
import {
  parseFeedbackFilterArgs,
  feedbackFilterSummary,
  writeFeedbackInboxFiles,
} from "@/lib/engineerFeedback/exportFeedbackInbox";

async function main() {
  const filter = parseFeedbackFilterArgs(process.argv.slice(2));
  const summary = feedbackFilterSummary(filter);
  const { jsonlPath, mdPath, count } = await writeFeedbackInboxFiles(undefined, filter);
  console.log(summary ? `Exported ${count} rating(s) — ${summary}:` : `Exported ${count} rating(s):`);
  console.log(`  ${jsonlPath}`);
  console.log(`  ${mdPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
