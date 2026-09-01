import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function summarizeCalData(data: unknown): void {
  if (!data || typeof data !== "object") { console.log("  (not an object)"); return; }
  const obj = data as Record<string, unknown>;
  console.log("  top-level keys:", Object.keys(obj).join(", "));
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      console.log(`  ${k}: array of ${v.length}; first 3:`, JSON.stringify(v.slice(0, 3), null, 2).slice(0, 1500));
    } else if (v && typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>);
      console.log(`  ${k}: object with ${entries.length} keys; first 5:`, JSON.stringify(Object.fromEntries(entries.slice(0, 5)), null, 2).slice(0, 1500));
    } else {
      console.log(`  ${k}:`, JSON.stringify(v)?.slice(0, 200));
    }
  }
}

async function main() {
  const model = await prisma.setupSheetModel.findFirstOrThrow({
    where: { slug: "awesomatix_a800rr" },
    select: { id: true, schemaJson: true },
  });
  const schema = model.schemaJson as { fields?: Array<{ key: string; label?: string }> } | Array<{ key: string; label?: string }>;
  const fields = Array.isArray(schema) ? schema : (schema.fields ?? []);
  console.log(`MODEL schemaJson: ${Array.isArray(schema) ? "array" : "object keys: " + Object.keys(schema).join(",")} — ${fields.length} fields`);
  console.log("  first 15 keys:", fields.slice(0, 15).map((f) => f.key).join(" | "));

  const blank = await prisma.setupSheetBlank.findUniqueOrThrow({
    where: { id: "cmsvng6nx0005jn04yqmmda56" },
    select: { schemaFieldsJson: true },
  });
  const ed = blank.schemaFieldsJson as Array<{ key: string; label?: string; paramType?: string }>;
  console.log(`\nEDITION schemaFieldsJson: ${ed.length} fields`);
  console.log("  first 3 full:", JSON.stringify(ed.slice(0, 3), null, 2));
  console.log("  all keys:", ed.map((f) => f.key).join(" | ").slice(0, 3000));

  for (const calId of ["cmo240muc0003vleo74uxxeyr", "cmsvng6m00003jn04kr0nzqlw"]) {
    const cal = await prisma.setupSheetCalibration.findUniqueOrThrow({
      where: { id: calId },
      select: { name: true, calibrationDataJson: true },
    });
    console.log(`\nCALIBRATION ${calId} (${cal.name}):`);
    summarizeCalData(cal.calibrationDataJson);
  }
}

main().finally(() => prisma.$disconnect());
