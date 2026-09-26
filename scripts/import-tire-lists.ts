/**
 * Import the per-class tire lists swept 2026-09-26 into TireType: 1/8 off-road, 1/8 on-road, the
 * pan cars, formula and 1/10 touring foam (`seeds/tires_<list>.json`, one file per list).
 *
 * Founder "fix all of these issues", 2026-09-26, over the review's "pan cars, 1/12, formula,
 * nitro and 1/8 cars pick from buggy and touring tires". Swept the way the 1/10 off-road list was
 * (`import-offroad-tires.ts`, whose rules this copies): one row = brand + tread + compound, the
 * list's name is the row's `discipline` (the bucket `tireProfile.ts` maps each class to), and every
 * row lands VERIFIED — a tire from our own list is trusted on arrival (founder ruling 2026-09-26).
 *
 * The model code carries the list, unlike the 1/10 lists: brands reuse tread names across scales
 * (an AKA Double Down is a 1/10 AND a 1/8 tire), and a code another list already holds is refused
 * as a clash, so a 1/8 row keyed like its 1/10 namesake would silently never load.
 *
 * Idempotent: upsert by modelCode, never touches createdBy, never moves a verification date.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/import-tire-lists.ts --dry
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx scripts/import-tire-lists.ts
 *   ... --list=pan            one list
 *   ... --brand="Contact RC"  one brand
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/prisma";
import { positionFromFits } from "@/lib/tires/tireCatalogFilter";

/** Each list: its seed file, and the tag its model codes carry. */
const LISTS = {
  "offroad-8th": { file: "seeds/tires_offroad_8th.json", codeTag: "8TH" },
  "onroad-8th": { file: "seeds/tires_onroad_8th.json", codeTag: "8TH-ONROAD" },
  pan: { file: "seeds/tires_pan.json", codeTag: "PAN" },
  formula: { file: "seeds/tires_formula.json", codeTag: "F1" },
  "touring-foam": { file: "seeds/tires_touring_foam.json", codeTag: "FOAM-10TH" },
} as const;
type ListName = keyof typeof LISTS;

type SeedRow = {
  brand: string;
  model?: string | null;
  compound?: string | null;
  surface?: string | null;
  tire_type?: string;
  source_url?: string | null;
  product_url?: string | null;
  fits?: { class?: string; position?: string }[] | null;
};

function slug(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function importList(list: ListName, opts: { dry: boolean; brand: string | null }): Promise<void> {
  const { file, codeTag } = LISTS[list];
  const rows = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8")) as SeedRow[];
  const now = new Date();
  const perBrand = new Map<string, number>();
  const perPosition = new Map<string, number>();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const clashes: string[] = [];

  for (const row of rows) {
    const brand = row.brand?.trim();
    const model = row.model?.trim() || "";
    const compound = row.compound?.trim() || "";
    if (!brand || (!model && !compound)) {
      skipped++;
      continue;
    }
    if (opts.brand && brand.toLowerCase() !== opts.brand) continue;

    const modelCode = slug([brand, model, compound, codeTag].filter(Boolean).join("-"));
    const data = {
      displayName: [brand, model, compound].filter(Boolean).join(" "),
      discipline: list,
      brand,
      model: model || null,
      compound: compound || null,
      surface: row.surface?.trim() || "unknown",
      tireType: row.tire_type?.trim() || "rubber",
      position: positionFromFits(row.fits),
      sourceUrl: row.source_url?.trim() || null,
      productUrl: row.product_url?.trim() || null,
    };

    const existing = await prisma.tireType.findUnique({
      where: { modelCode },
      select: { id: true, discipline: true, verifiedAt: true },
    });
    if (existing && existing.discipline && existing.discipline !== list) {
      clashes.push(`${modelCode} (held by ${existing.discipline})`);
      skipped++;
      continue;
    }
    if (opts.dry) {
      if (existing) updated++;
      else created++;
    } else if (existing) {
      await prisma.tireType.update({
        where: { modelCode },
        data: { ...data, ...(existing.verifiedAt ? {} : { verifiedAt: now }) },
      });
      updated++;
    } else {
      await prisma.tireType.create({ data: { modelCode, ...data, verifiedAt: now } });
      created++;
    }
    perBrand.set(brand, (perBrand.get(brand) ?? 0) + 1);
    const pos = data.position ?? "untagged";
    perPosition.set(pos, (perPosition.get(pos) ?? 0) + 1);
  }

  console.log(`\n${list}${opts.dry ? " (DRY RUN)" : ""}: created ${created}, updated ${updated}, skipped ${skipped}`);
  console.log(`  ${[...perBrand.entries()].sort().map(([b, n]) => `${b} ${n}`).join(", ")}`);
  console.log(`  fits: ${[...perPosition.entries()].sort().map(([p, n]) => `${p} ${n}`).join(", ")}`);
  if (clashes.length) console.log(`  model-code clashes (${clashes.length}):\n    ${clashes.join("\n    ")}`);
}

async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const only = arg("list");
  if (only && !(only in LISTS)) throw new Error(`unknown --list=${only}; one of ${Object.keys(LISTS).join(", ")}`);
  const brand = arg("brand")?.toLowerCase() ?? null;
  const lists = (only ? [only] : Object.keys(LISTS)) as ListName[];

  for (const list of lists) await importList(list, { dry, brand });

  if (!dry) {
    const total = await prisma.tireType.count();
    const counts = await Promise.all(
      lists.map(async (l) => `${l} ${await prisma.tireType.count({ where: { discipline: l } })}`)
    );
    console.log(`\ncatalog now: ${total} tire types; ${counts.join(", ")}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
