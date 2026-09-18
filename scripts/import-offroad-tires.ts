/**
 * Import the 1/10 off-road tire sweep (seeds/tires_offroad_10th.json) into TireType.
 *
 * Same shape as `import-touring-tires.ts` — rows land UNVERIFIED (verifiedAt = null), which is
 * where every touring row already sits, so the picker's verified-first sort stays a no-op and
 * nothing in the catalog is ranked above anything else by accident.
 *
 * Founder call 2026-09-18: import EVERY tire the sweep found — all 584 rows, including the 107
 * the review flagged as likely drops (dirt oval, vintage, Kyosho kit spares) and the 57 marked
 * discontinued. A tire that is in the list and shouldn't be costs a driver one scroll; a tire
 * that is missing costs them the log. Category is the coarse bucket ("offroad-10th"), not the
 * race class — drivers find the rest by typing.
 *
 * One row = brand + tread + compound (founder call 2026-09-16), so that triple is the identity
 * and the modelCode. Fitment, size, softness, tread style and surfaces are carried in the seed
 * file but have no columns yet — they are the raw material for class-level filtering later.
 *
 * Idempotent: upsert by modelCode, never touches verifiedAt or createdBy.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/import-offroad-tires.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/import-offroad-tires.ts --brand=JConcepts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/import-offroad-tires.ts --dry
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";

export const OFFROAD_10TH_DISCIPLINE = "offroad-10th";

type SeedRow = {
  brand: string;
  discipline?: string;
  model?: string | null;
  compound?: string | null;
  surface?: string | null;
  tire_type?: string;
  source_url?: string | null;
  product_url?: string | null;
};

function slug(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const brandArg = process.argv
    .find((a) => a.startsWith("--brand="))
    ?.split("=")[1]
    ?.toLowerCase();
  const dry = process.argv.includes("--dry");

  const path = resolve(process.cwd(), "seeds/tires_offroad_10th.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as SeedRow[];

  if (process.argv.includes("--reset") && !dry) {
    const del = await prisma.tireType.deleteMany({
      where: {
        discipline: OFFROAD_10TH_DISCIPLINE,
        verifiedAt: null, // never delete a founder-approved row
        ...(brandArg ? { brand: { equals: brandArg, mode: "insensitive" } } : {}),
      },
    });
    console.log(`--reset: deleted ${del.count} unverified off-road row(s)`);
  }

  const perBrand = new Map<string, number>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const clashes: string[] = [];

  for (const row of rows) {
    const brand = row.brand?.trim();
    const model = row.model?.trim() || "";
    const compound = row.compound?.trim() || "";
    // 15 rows are a tread with no separate compound (the tread name IS the product).
    if (!brand || (!model && !compound)) {
      skipped++;
      continue;
    }
    if (brandArg && brand.toLowerCase() !== brandArg) continue;

    const modelCode = slug([brand, model, compound].filter(Boolean).join("-"));
    const data = {
      displayName: [brand, model, compound].filter(Boolean).join(" "),
      discipline: row.discipline?.trim() || OFFROAD_10TH_DISCIPLINE,
      brand,
      model: model || null,
      compound: compound || null,
      surface: row.surface?.trim() || "unknown",
      tireType: row.tire_type?.trim() || "rubber",
      sourceUrl: row.source_url?.trim() || null,
      productUrl: row.product_url?.trim() || null,
    };

    const existing = await prisma.tireType.findUnique({
      where: { modelCode },
      select: { id: true, discipline: true },
    });
    // A code already held by a row from another catalog is a real identity clash, not an update.
    if (existing && existing.discipline && existing.discipline !== data.discipline) {
      clashes.push(`${modelCode} (held by ${existing.discipline})`);
      skipped++;
      continue;
    }
    if (dry) {
      if (existing) updated++;
      else created++;
    } else if (existing) {
      await prisma.tireType.update({ where: { modelCode }, data }); // never touches verifiedAt
      updated++;
    } else {
      await prisma.tireType.create({ data: { modelCode, ...data } }); // verifiedAt defaults null
      created++;
    }
    perBrand.set(brand, (perBrand.get(brand) ?? 0) + 1);
  }

  console.log(`\n1/10 off-road tire import${dry ? " (DRY RUN)" : ""}${brandArg ? ` brand=${brandArg}` : ""}:`);
  for (const [b, n] of [...perBrand.entries()].sort()) console.log(`  ${b} — ${n}`);
  console.log(`\ncreated ${created}, updated ${updated}, skipped ${skipped}`);
  if (clashes.length) console.log(`model-code clashes with another catalog (${clashes.length}):\n  ${clashes.join("\n  ")}`);

  if (!dry) {
    const total = await prisma.tireType.count();
    const offroad = await prisma.tireType.count({ where: { discipline: OFFROAD_10TH_DISCIPLINE } });
    console.log(`\ncatalog now: ${total} tire types, ${offroad} of them ${OFFROAD_10TH_DISCIPLINE}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
