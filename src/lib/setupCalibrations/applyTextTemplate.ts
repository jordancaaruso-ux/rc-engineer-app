import "server-only";

import type { SetupSnapshotData } from "@/lib/runSetup";
import type { PdfTextStructureDocument } from "@/lib/setupDocuments/pdfTextStructure";
import type { TextFieldMappingRule } from "@/lib/setupCalibrations/types";
import { getCalibrationFieldKind } from "@/lib/setupCalibrations/calibrationFieldCatalog";
import { parseNumericFromSetupString } from "@/lib/setup/parseSetupNumeric";

function normalizeAnchor(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeTemplateExtractedValue(raw: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (/^(yes|true)$/i.test(cleaned)) return "1";
  if (/^(no|false)$/i.test(cleaned)) return "";
  if (/^[ivx]+$/i.test(cleaned)) return cleaned.toUpperCase();
  if (/^(low|high|\+1)$/i.test(cleaned)) return cleaned.toLowerCase();
  return cleaned;
}

function normalizeTemplateExtractedValueForField(raw: string, fieldKey: string): string {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const kind = getCalibrationFieldKind(fieldKey);
  if (kind === "text" || kind === "documentMetadata") {
    // Preserve full alphanumeric text exactly for textual fields.
    return cleaned;
  }
  if (kind === "number") {
    const n = parseNumericFromSetupString(cleaned, { allowKSuffix: false });
    if (n != null) return String(n);
    return cleaned;
  }
  return normalizeTemplateExtractedValue(cleaned);
}

type StructuredLine = PdfTextStructureDocument["pages"][number]["lines"][number];

function linesForPage(structure: PdfTextStructureDocument, page: number): StructuredLine[] {
  const p = structure.pages.find((x) => x.pageNumber === page);
  return p?.lines ?? [];
}

function valueFromFixedLine(
  structure: PdfTextStructureDocument,
  rule: Extract<TextFieldMappingRule, { mode: "fixed_line_token" }>
): string {
  const lines = linesForPage(structure, rule.page);
  const line = lines[rule.lineIndex];
  const tok = line?.tokens[rule.tokenIndex];
  return tok?.text?.trim() ?? "";
}

function valueFromAnchor(
  structure: PdfTextStructureDocument,
  rule: Extract<TextFieldMappingRule, { mode: "anchor_token" }>
): string {
  const lines = linesForPage(structure, rule.page);
  const needle = normalizeAnchor(rule.anchorContains);
  const matches: StructuredLine[] = [];
  for (const line of lines) {
    if (normalizeAnchor(line.text).includes(needle)) matches.push(line);
  }
  const occ = rule.occurrence ?? 0;
  const line = matches[occ];
  const tok = line?.tokens[rule.tokenIndex];
  return tok?.text?.trim() ?? "";
}

export function applyTextFieldRule(structure: PdfTextStructureDocument, rule: TextFieldMappingRule): string {
  if (rule.mode === "fixed_line_token") return valueFromFixedLine(structure, rule);
  if (rule.mode === "anchor_token") return valueFromAnchor(structure, rule);
  return "";
}

export function applyAllTextFieldMappings(
  structure: PdfTextStructureDocument,
  fieldMappings: Record<string, TextFieldMappingRule>
): { parsedData: SetupSnapshotData; importedKeys: string[] } {
  const parsedData: SetupSnapshotData = {};
  const importedKeys: string[] = [];
  for (const [fieldKey, rule] of Object.entries(fieldMappings)) {
    const raw = applyTextFieldRule(structure, rule);
    const v = normalizeTemplateExtractedValueForField(raw, fieldKey);
    if (!v) continue;
    parsedData[fieldKey] = v;
    importedKeys.push(fieldKey);
  }
  return { parsedData, importedKeys };
}
