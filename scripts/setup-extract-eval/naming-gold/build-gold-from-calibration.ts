/**
 * Turn a HAND-NAMED chassis into an answer key for the box namer.
 *
 * Jordan named every box of a few sheets by hand (Mugen MTC3, Schumacher Mi10). Their calibration
 * maps his field keys onto the blank PDF's field names, and the chassis schema holds his labels, so
 * together they say what a racer calls each PDF box. The namer is scored against that.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/naming-gold/build-gold-from-calibration.ts --name="Mugen MTC3" --out=<gold.json>
 *
 * Output: { car, gold: { [pdfFieldName]: { label, optionLabel?, options?: { [widgetIndex]: label } } } }
 * — the shape score-naming.cjs reads.
 */
import { writeFileSync } from "node:fs";

import { prisma } from "@/lib/prisma";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

type Rule = {
  mode?: string;
  pdfFieldName?: string;
  options?: Record<string, { widgetInstanceIndex?: number; pdfFieldName?: string }>;
};

async function main() {
  const name = arg("name"), out = arg("out");
  if (!name || !out) throw new Error("need --name and --out");
  const model = await prisma.setupSheetModel.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { name: true, schemaJson: true, defaultCalibrationId: true, calibrations: { select: { id: true, name: true, calibrationDataJson: true } } },
  });
  if (!model) throw new Error(`no chassis named ${name}`);
  const fields = ((model.schemaJson as { fields?: Array<{ key: string; displayLabel?: string }> })?.fields ?? []);
  const labelOf = new Map(fields.map((f) => [f.key, f.displayLabel ?? f.key]));
  const cal = model.calibrations.find((c) => c.id === model.defaultCalibrationId) ?? model.calibrations[0];
  const mappings = ((cal?.calibrationDataJson as { formFieldMappings?: Record<string, Rule> })?.formFieldMappings ?? {});

  const gold: Record<string, { label: string; optionLabel?: string; options?: Record<string, string> }> = {};
  for (const [key, rule] of Object.entries(mappings)) {
    const label = labelOf.get(key) ?? key;
    const mode = rule.mode ?? "acroField";
    if ((mode === "singleChoiceWidgetGroup" || mode === "multiSelectWidgetGroup") && rule.pdfFieldName) {
      const options: Record<string, string> = {};
      for (const [value, o] of Object.entries(rule.options ?? {})) if (typeof o.widgetInstanceIndex === "number") options[o.widgetInstanceIndex] = value;
      gold[rule.pdfFieldName] = { label, options };
    } else if (mode === "singleChoiceNamedFields" || mode === "multiSelectNamedFields") {
      for (const [value, o] of Object.entries(rule.options ?? {})) if (o.pdfFieldName) gold[o.pdfFieldName] = { label, optionLabel: value };
    } else if (rule.pdfFieldName) {
      gold[rule.pdfFieldName] = { label };
    }
  }
  writeFileSync(out, JSON.stringify({ car: model.name, calibration: cal?.name, gold }, null, 1));
  console.log(`${model.name} (${cal?.name}): ${Object.keys(gold).length} PDF boxes in the answer key → ${out}`);
}

main().finally(() => prisma.$disconnect());
