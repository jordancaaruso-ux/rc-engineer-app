/**
 * Export in-app Engineer ratings → docs/engineer-feedback/inbox.{jsonl,md}
 * Run: npm run engineer:export-feedback
 */
import { writeFeedbackInboxFiles } from "@/lib/engineerFeedback/exportFeedbackInbox";

async function main() {
  const { jsonlPath, mdPath, count } = await writeFeedbackInboxFiles();
  console.log(`Exported ${count} rating(s):`);
  console.log(`  ${jsonlPath}`);
  console.log(`  ${mdPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
