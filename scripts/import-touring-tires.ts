/**
 * Import the grounded touring-tire pre-seed (seeds/tires_touring.json) into TireType as UNVERIFIED
 * rows (verifiedAt = null) so they surface in /admin/review for founder approval — the Phase-3
 * AI-catalog-preseed flow in docs/ASSET_ACCESS_NORTH_STAR.md ("approved rows land verified").
 *
 * Idempotent: upsert by modelCode. Never touches verifiedAt or createdBy — re-running won't
 * un-verify an approved row. It DOES overwrite catalog attributes from the seed, so treat the seed
 * file as the source of truth for unapproved rows.
 *
 * Run against the dev Neon branch (never prod):
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/import-touring-tires.ts                 # all brands
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/import-touring-tires.ts --brand=Sweep   # one brand (dry run)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";

type SeedRow = {
  brand: string;
  discipline?: string;
  model?: string;
  compound: string;
  surface?: string;
  tire_type?: string;
  source_url?: string;
  product_url?: string;
  notes?: string;
};

function slug(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function main(): Promise<void> {
  const brandArg = process.argv
    .find((a) => a.startsWith("--brand="))
    ?.split("=")[1]
    ?.toLowerCase();

  const path = resolve(process.cwd(), "seeds/tires_touring.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as SeedRow[];

  if (process.argv.includes("--reset")) {
    const del = await prisma.tireType.deleteMany({
      where: {
        discipline: "touring",
        verifiedAt: null, // never delete a founder-approved row
        ...(brandArg ? { brand: { equals: brandArg, mode: "insensitive" } } : {}),
      },
    });
    console.log(`--reset: deleted ${del.count} unverified touring row(s)${brandArg ? ` for ${brandArg}` : ""}`);
  }

  const perBrand = new Map<string, number>();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const brand = row.brand?.trim();
    const compound = row.compound?.trim();
    if (!brand || !compound) {
      skipped++;
      continue;
    }
    if (brandArg && brand.toLowerCase() !== brandArg) continue;

    const surface = row.surface?.trim() || "unknown";
    const model = row.model?.trim() || "";
    const norm = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    // Include model in identity so two lines sharing a compound+surface stay distinct
    // (e.g. Sweep "SR-CX PRO" CX32 vs "R3-WIDE" CX32). Drop it from the label when the
    // compound already carries it (e.g. model "D" / compound "D-32").
    const showModel = model !== "" && !norm(compound).startsWith(norm(model));
    const modelCode = slug([brand, showModel ? model : "", compound, surface].filter(Boolean).join("-"));
    const data = {
      displayName: (showModel ? `${brand} ${model} ${compound}` : `${brand} ${compound}`).trim(),
      discipline: row.discipline?.trim() || "touring",
      brand,
      model: model || null,
      compound,
      surface,
      tireType: row.tire_type?.trim() || "rubber",
      sourceUrl: row.source_url?.trim() || null,
      productUrl: row.product_url?.trim() || null,
    };

    const existing = await prisma.tireType.findUnique({
      where: { modelCode },
      select: { id: true },
    });
    if (existing) {
      await prisma.tireType.update({ where: { modelCode }, data }); // never touches verifiedAt
      updated++;
    } else {
      await prisma.tireType.create({ data: { modelCode, ...data } }); // verifiedAt defaults null
      created++;
    }
    perBrand.set(brand, (perBrand.get(brand) ?? 0) + 1);
  }

  console.log(`\nTouring tire import ${brandArg ? `(brand=${brandArg})` : "(all brands)"}:`);
  for (const [b, n] of [...perBrand.entries()].sort()) console.log(`  ${b} — ${n}`);
  console.log(`\ncreated ${created}, updated ${updated}, skipped ${skipped}, total ${created + updated}`);

  const samples = await prisma.tireType.findMany({
    where: { discipline: "touring" },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: {
      displayName: true,
      modelCode: true,
      brand: true,
      compound: true,
      surface: true,
      tireType: true,
      productUrl: true,
      verifiedAt: true,
    },
  });
  console.log("\nsample staged rows:");
  console.log(JSON.stringify(samples, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
