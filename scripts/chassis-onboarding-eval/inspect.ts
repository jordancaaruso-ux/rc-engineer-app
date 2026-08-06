import { readFile } from "node:fs/promises";
import path from "node:path";
import { proposeSheetFromPdf, groupTitle, type ProposedField } from "@/lib/chassisOnboarding/proposeSheet";
import { SETUP_SHEET_GROUPS } from "@/lib/setupSheetModels/setupSheetGroups";

/**
 * Print the setup sheet the pipeline would propose for a blank PDF, so it can be judged the only
 * way that matters: would this ship?
 *
 *   npm run chassis-onboarding:inspect -- <path-to-blank.pdf> [--all]
 *
 * Default output is the sheet as a driver would meet it, grouped. `--all` adds every field with
 * where its name came from.
 */

const SOURCE_MARK: Record<ProposedField["source"], string> = {
  registry: "✓✓",
  corpus: "✓ ",
  printed: "· ",
  unnamed: "? ",
};

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const showAll = process.argv.includes("--all");
  const file = args[0];
  if (!file) {
    console.error("Usage: npm run chassis-onboarding:inspect -- <path-to-blank.pdf> [--all]");
    process.exit(1);
  }

  const bytes = await readFile(path.resolve(process.cwd(), file));
  const proposal = await proposeSheetFromPdf(bytes);

  const counts = { registry: 0, corpus: 0, printed: 0, unnamed: 0 };
  for (const f of proposal.fields) counts[f.source] += 1;
  const named = counts.registry + counts.corpus + counts.printed;

  console.log(`\n${path.basename(file)} — ${proposal.fields.length} boxes, ${proposal.pageCount} page(s)`);
  console.log(
    `Printed text: ${proposal.printedPhraseCount} phrases, ${proposal.distinctCaptionCount} distinct captions`
  );
  console.log(
    `Names: ${counts.registry} from the registry, ${counts.corpus} from existing sheets, ` +
      `${counts.printed} from the sheet's own print, ${counts.unnamed} with nothing to go on`
  );
  const needsHuman = counts.unnamed + proposal.duplicateLabelCount;
  console.log(
    `→ ${named}/${proposal.fields.length} boxes arrive with a proposed name, but ` +
      `${proposal.duplicateLabelCount} of those names are claimed by more than one box.`
  );
  console.log(
    `→ ${needsHuman} boxes need a decision; ${proposal.fields.length - needsHuman} can be accepted as proposed.`
  );
  for (const w of proposal.warnings) console.log(`! ${w}`);

  console.log("\nProposed sheet (✓✓ registry · ✓ existing sheet · · printed on sheet · ? unnamed · ⚠ name clash)\n");
  for (const group of SETUP_SHEET_GROUPS) {
    const rows = proposal.fields.filter((f) => f.group === group.id);
    if (rows.length === 0) continue;
    console.log(`── ${groupTitle(group.id)} (${rows.length})`);
    for (const f of rows) {
      const unit = f.unit ? ` ${f.unit}` : "";
      const choice = f.widgetCount > 1 ? ` [${f.widgetCount}-way choice]` : "";
      const opts = f.pdfOptions?.length ? ` {${f.pdfOptions.slice(0, 6).join(", ")}}` : "";
      const clash = f.duplicateLabel ? " ⚠" : "";
      const detail = showAll ? `   ${f.acroName}` : "";
      console.log(
        `  ${SOURCE_MARK[f.source]} ${shorten(f.label, 38).padEnd(38)}${unit}${choice}${opts}${clash}${detail}`
      );
    }
    console.log("");
  }

  const unnamed = proposal.fields.filter((f) => f.source === "unnamed");
  if (unnamed.length > 0) {
    console.log(`── Needs a human (${unnamed.length}), in sheet order`);
    for (const f of unnamed.slice(0, 60)) {
      console.log(
        `  ? ${f.acroName.padEnd(24)} page ${f.position.page} @ ${(f.position.x * 100).toFixed(0)}%,${(f.position.y * 100).toFixed(0)}%${f.widgetCount > 1 ? ` [${f.widgetCount} boxes]` : ""}`
      );
    }
    if (unnamed.length > 60) console.log(`  … ${unnamed.length - 60} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
