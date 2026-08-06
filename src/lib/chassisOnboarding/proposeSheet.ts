import {
  parseOnboardingGeometry,
  type OnboardingGeometry,
  type OnboardingGeometryField,
} from "@/lib/chassisOnboarding/geometry";
import { buildStaticLabelCorpus, type CorpusEntry } from "@/lib/chassisOnboarding/labelCorpus";
import { matchAllFields, type FieldMatch, type MatchTier } from "@/lib/chassisOnboarding/matchFields";
import {
  extractPrintedText,
  labelCandidatesForRegion,
  unitHintForRegion,
  type PrintedPhrase,
} from "@/lib/chassisOnboarding/printedText";
import { groupForFieldKey, SETUP_SHEET_GROUPS, type SetupSheetGroupId } from "@/lib/setupSheetModels/setupSheetGroups";

/**
 * Turn a blank AcroForm setup sheet into a proposed parameter list, deterministically.
 *
 * Everything here is read off the PDF: the boxes, their captions, their units. Where a caption or a
 * field name lines up with a label already shipped, the proposal reuses that exact label; where it
 * doesn't, the proposal falls back to the caption the manufacturer printed. No label is invented,
 * so a human reviewing this is confirming words that already exist somewhere authoritative.
 */

export type ProposedFieldSource =
  /** Reused a label already shipped, resolved through the universal registry. */
  | "registry"
  /** Reused a label already shipped, matched on wording. */
  | "corpus"
  /** The caption printed beside the box on the sheet. */
  | "printed"
  /** Nothing to go on — the box gets its PDF field name and needs a human. */
  | "unnamed";

export type ProposedField = {
  key: string;
  acroName: string;
  label: string;
  source: ProposedFieldSource;
  tier: MatchTier;
  group: SetupSheetGroupId;
  kind: OnboardingGeometryField["kind"];
  unit?: string;
  universalParameterId?: string;
  /** Options the PDF itself carries (dropdown lists). */
  pdfOptions?: string[];
  /** Boxes belonging to this field — more than one means it is a choice group. */
  widgetCount: number;
  /** Alternative labels to offer in the picker. */
  alternates: string[];
  /**
   * Another box on this sheet proposes the same name. One sheet cannot have two "Caster (Front)"
   * rows, so every claimant needs a human to say which is which — typically one is the measured
   * value and the other the hardware choice that sets it.
   */
  duplicateLabel: boolean;
  printedCaption?: string;
  /** Top-left of the first box, for ordering the review walk by position on the sheet. */
  position: { page: number; x: number; y: number };
};

export type SheetProposal = {
  pageCount: number;
  fields: ProposedField[];
  /** Total printed phrases found; near zero means the sheet's text was flattened to outlines. */
  printedPhraseCount: number;
  /** Distinct captions across all boxes — the honest measure of how much the text layer names. */
  distinctCaptionCount: number;
  /** Boxes whose proposed name collides with another box's. */
  duplicateLabelCount: number;
  warnings: string[];
};

function labelFromMatch(match: FieldMatch, caption: string | undefined, acroName: string): {
  label: string;
  source: ProposedFieldSource;
} {
  if (match.entry && match.tier !== "residue") {
    return { label: match.entry.displayLabel, source: match.reason === "registry" ? "registry" : "corpus" };
  }
  if (caption) return { label: caption, source: "printed" };
  return { label: acroName, source: "unnamed" };
}

function toTitle(text: string): string {
  // Sheets shout their captions ("GEAR DIFF OIL"); the app's labels are sentence case.
  if (text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-z])/g, (_m, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`);
}

export function buildProposalFromParts(input: {
  geometry: OnboardingGeometry;
  phrasesByPage: Map<number, PrintedPhrase[]>;
  corpus: CorpusEntry[];
}): SheetProposal {
  const { geometry, phrasesByPage, corpus } = input;

  const captionByKey = new Map<string, string>();
  const unitByKey = new Map<string, string>();
  for (const field of geometry.fields) {
    const w0 = field.widgets[0]!;
    const phrases = phrasesByPage.get(w0.pageNumber) ?? [];
    const best = labelCandidatesForRegion(phrases, w0.region, 1)[0];
    if (best) captionByKey.set(field.key, best.text);
    const unit = unitHintForRegion(phrases, w0.region);
    if (unit) unitByKey.set(field.key, unit);
  }

  const matches = matchAllFields(
    geometry.fields.map((f) => ({
      key: f.key,
      acroName: f.acroName,
      printedLabel: captionByKey.get(f.key),
    })),
    corpus
  );

  const fields: ProposedField[] = geometry.fields.map((field) => {
    const match = matches.get(field.key)!;
    const caption = captionByKey.get(field.key);
    const { label, source } = labelFromMatch(match, caption ? toTitle(caption) : undefined, field.acroName);
    const w0 = field.widgets[0]!;
    return {
      key: field.key,
      acroName: field.acroName,
      label,
      source,
      tier: match.tier,
      group: groupForFieldKey(field.key, label) ?? "other",
      kind: field.kind,
      unit: match.entry?.unit ?? unitByKey.get(field.key),
      universalParameterId: match.entry?.universalParameterId,
      pdfOptions: field.pdfOptions,
      widgetCount: field.widgets.length,
      alternates: match.alternates.map((a) => a.displayLabel),
      duplicateLabel: false,
      printedCaption: caption,
      position: { page: w0.pageNumber, x: w0.region.xPct, y: w0.region.yPct },
    };
  });

  // Review order follows the sheet, so a human walking the leftovers moves down the page rather
  // than jumping around it.
  fields.sort((a, b) => {
    if (a.position.page !== b.position.page) return a.position.page - b.position.page;
    if (Math.abs(a.position.y - b.position.y) > 0.004) return a.position.y - b.position.y;
    return a.position.x - b.position.x;
  });

  // A proposed name claimed by two boxes names neither of them. Both are marked so review sees the
  // pair together rather than discovering the clash after the sheet ships.
  const claimCount = new Map<string, number>();
  for (const f of fields) {
    const norm = f.label.trim().toLowerCase();
    claimCount.set(norm, (claimCount.get(norm) ?? 0) + 1);
  }
  let duplicateLabelCount = 0;
  for (const f of fields) {
    if ((claimCount.get(f.label.trim().toLowerCase()) ?? 0) > 1) {
      f.duplicateLabel = true;
      duplicateLabelCount += 1;
    }
  }

  let printedPhraseCount = 0;
  for (const phrases of phrasesByPage.values()) printedPhraseCount += phrases.length;

  return {
    pageCount: geometry.pageCount,
    fields,
    printedPhraseCount,
    distinctCaptionCount: new Set(captionByKey.values()).size,
    duplicateLabelCount,
    warnings: geometry.warnings,
  };
}

export async function proposeSheetFromPdf(pdfBytes: Buffer): Promise<SheetProposal> {
  const geometry = await parseOnboardingGeometry(pdfBytes);
  const printedPages = await extractPrintedText(pdfBytes);
  return buildProposalFromParts({
    geometry,
    phrasesByPage: new Map(printedPages.map((p) => [p.pageNumber, p.phrases])),
    corpus: buildStaticLabelCorpus(),
  });
}

export function groupTitle(id: SetupSheetGroupId): string {
  return SETUP_SHEET_GROUPS.find((g) => g.id === id)?.title ?? "Other";
}
