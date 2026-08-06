import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseOnboardingGeometry } from "@/lib/chassisOnboarding/geometry";
import { buildStaticLabelCorpus } from "@/lib/chassisOnboarding/labelCorpus";
import { matchAllFields, type FieldMatch } from "@/lib/chassisOnboarding/matchFields";
import { extractPrintedText, labelCandidatesForRegion } from "@/lib/chassisOnboarding/printedText";

/**
 * Does fast chassis onboarding actually save time? Answer that on real sheets before building any
 * UI for it.
 *
 * The number that matters is WIZARD ITEMS: how many decisions a human still has to make after the
 * deterministic pass. Onboarding a chassis by hand today means authoring every field, so a sheet
 * with 201 boxes that leaves 25 decisions is the win; one that leaves 180 is the current process
 * wearing a hat.
 *
 * Run: npx tsx scripts/chassis-onboarding-eval/run.ts [--samples]
 */

const SHEETS = [
  { name: "Xray X4'26", file: "scripts/setup-extract-eval/gold/xray-x4-2026/files/x4_2026_set_up_editable_v02.pdf" },
  { name: "Xray X4'22", file: "scripts/setup-extract-eval/gold/xray-x4-2022/files/X42022_blank.pdf" },
  { name: "Mugen MTC3", file: "scripts/setup-extract-eval/gold/mugen-mtc3/files/MTC3_EditableSetupSheet_CW.pdf" },
  /** The worst case on purpose: Acrobat-default field names carrying no information at all. */
  { name: "Awesomatix A800RR", file: "public/setup-sheets/A800RR.pdf" },
];

type SheetResult = {
  name: string;
  pageCount: number;
  total: number;
  auto: number;
  suggested: number;
  residue: number;
  opaque: number;
  universalMapped: number;
  dropdownsWithOptions: number;
  multiWidgetChoice: number;
  bulkAcceptItems: number;
  wizardItems: number;
  printedCaptions: number;
  residueWithCaption: number;
  samples: Array<{
    acroName: string;
    tier: string;
    label: string;
    score: number;
    reason: string;
    printed: string;
  }>;
};

function pct(n: number, of: number): string {
  if (of === 0) return "0%";
  return `${Math.round((n / of) * 100)}%`;
}

async function evaluateSheet(sheet: (typeof SHEETS)[number], corpusSize: number): Promise<SheetResult> {
  const bytes = await readFile(path.resolve(process.cwd(), sheet.file));
  const geometry = await parseOnboardingGeometry(bytes);
  const corpus = buildStaticLabelCorpus();

  const printedPages = await extractPrintedText(bytes);
  const phrasesByPage = new Map(printedPages.map((p) => [p.pageNumber, p.phrases]));
  const printedLabelByKey = new Map<string, string>();
  for (const field of geometry.fields) {
    const w0 = field.widgets[0]!;
    const phrases = phrasesByPage.get(w0.pageNumber) ?? [];
    const best = labelCandidatesForRegion(phrases, w0.region, 1)[0];
    if (best) printedLabelByKey.set(field.key, best.text);
  }

  const matches = matchAllFields(
    geometry.fields.map((f) => ({
      key: f.key,
      acroName: f.acroName,
      printedLabel: printedLabelByKey.get(f.key),
    })),
    corpus
  );

  let auto = 0;
  let suggested = 0;
  let residue = 0;
  let opaque = 0;
  let universalMapped = 0;
  const samples: SheetResult["samples"] = [];

  for (const field of geometry.fields) {
    const m = matches.get(field.key) as FieldMatch;
    if (m.tier === "auto") auto += 1;
    else if (m.tier === "suggested") suggested += 1;
    else residue += 1;
    if (m.reason === "opaque_name") opaque += 1;
    if (m.entry?.universalParameterId) universalMapped += 1;
    samples.push({
      acroName: field.acroName,
      tier: m.tier,
      label: m.entry?.displayLabel ?? printedLabelByKey.get(field.key) ?? "—",
      score: m.score,
      reason: m.reason,
      printed: printedLabelByKey.get(field.key) ?? "",
    });
  }

  void corpusSize;
  // A residue field that still has a printed caption is cheap: the wizard proposes the
  // manufacturer's own word and the human confirms it, instead of naming the box from scratch.
  const residueWithCaption = geometry.fields.filter(
    (f) => matches.get(f.key)!.tier === "residue" && printedLabelByKey.has(f.key)
  ).length;

  return {
    name: sheet.name,
    pageCount: geometry.pageCount,
    total: geometry.fields.length,
    auto,
    suggested,
    residue,
    opaque,
    universalMapped,
    dropdownsWithOptions: geometry.fields.filter((f) => (f.pdfOptions?.length ?? 0) > 0).length,
    multiWidgetChoice: geometry.fields.filter((f) => f.kind === "checkbox" && f.widgets.length > 1).length,
    // Matched rows are reviewed as one bulk-accept screen; leftovers are named one at a time.
    bulkAcceptItems: auto + suggested > 0 ? 1 : 0,
    wizardItems: (auto + suggested > 0 ? 1 : 0) + residue,
    printedCaptions: printedLabelByKey.size,
    residueWithCaption,
    samples,
  };
}

async function main(): Promise<void> {
  const showSamples = process.argv.includes("--samples");
  const corpus = buildStaticLabelCorpus();
  console.log(`Approved label corpus: ${corpus.length} entries`);
  console.log(
    `  by source: ${["universal", "authorizedModel", "generic"]
      .map((s) => `${s}=${corpus.filter((e) => e.source === s).length}`)
      .join(" ")}`
  );
  console.log("");

  const results: SheetResult[] = [];
  for (const sheet of SHEETS) {
    try {
      results.push(await evaluateSheet(sheet, corpus.length));
    } catch (e) {
      console.error(`FAILED ${sheet.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const header = ["Sheet", "fields", "auto", "suggested", "residue", "opaque", "universal", "wizard items"];
  const rows = results.map((r) => [
    r.name,
    String(r.total),
    `${r.auto} (${pct(r.auto, r.total)})`,
    `${r.suggested} (${pct(r.suggested, r.total)})`,
    `${r.residue} (${pct(r.residue, r.total)})`,
    String(r.opaque),
    String(r.universalMapped),
    String(r.wizardItems),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
  console.log("");

  for (const r of results) {
    console.log(
      `${r.name}: ${r.pageCount} page(s), ${r.multiWidgetChoice} PDF-defined choice groups, ${r.dropdownsWithOptions} dropdown(s) with option lists`
    );
    console.log(
      `  printed captions found for ${r.printedCaptions}/${r.total} boxes (${pct(r.printedCaptions, r.total)}); ` +
        `${r.residueWithCaption} of ${r.residue} unmatched boxes have one to propose`
    );
  }

  if (showSamples) {
    for (const r of results) {
      console.log(`\n=== ${r.name} ===`);
      for (const tier of ["auto", "suggested", "residue"] as const) {
        const rows = r.samples.filter((s) => s.tier === tier);
        console.log(`\n-- ${tier} (${rows.length}) --`);
        for (const s of rows.slice(0, 40)) {
          const printed = s.printed && s.printed !== s.label ? `  [printed: ${s.printed}]` : "";
          console.log(
            `  ${s.acroName.padEnd(22)} → ${s.label.padEnd(30)} ${s.score.toFixed(2)} ${s.reason}${printed}`
          );
        }
        if (rows.length > 40) console.log(`  … ${rows.length - 40} more`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
