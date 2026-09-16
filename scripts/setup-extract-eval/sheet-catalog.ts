/**
 * Which sheets are worth naming, and in what order.
 *
 * Every chassis with a fillable blank PDF is a candidate for the per-box namer
 * (`draft-blank-v2.ts`). This lists them with the two numbers that decide priority: how many boxes
 * carry a meaningless name ("Text70"), and how many drivers actually race the car.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/sheet-catalog.ts [--all] [--json=<path>] [--limit=N]
 *
 * Default output is the naming queue: one page, fillable, still full of placeholders, most-raced
 * first. `--all` prints every sheet including the ones already named by hand.
 */
import { writeFileSync } from "node:fs";

import { prisma } from "@/lib/prisma";

type SchemaField = { key?: string; displayLabel?: string; section?: string };

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

/**
 * A label no human chose for this box. Three kinds, and all three read as nonsense to a driver:
 *  - Acrobat's own default, in any language ("Text70", "Texto47", "Casilla de verificación581").
 *  - The key prettified back into a label ("uppr_links_caster" -> "Uppr links caster").
 *  - A machine-split tick group ("Fr caster · box 1 of 3").
 */
const ACROBAT_DEFAULT =
  /^(text|txt|texto|texte|testo|tekst|check ?box|checkbox|casilla(\s+de\s+verificaci[oó]n)?|case\s*[àa]\s*cocher|kontrollk[äa]stchen|casella(\s+di\s+controllo)?|selectievakje|field|champ|campo|feld|box|untitled|radio|button|bot[oó]n|dropdown|combo|list|undefined)\s*[-_ ]?\d*$/i;

function prettifyKey(key: string): string {
  const words = key.replace(/__b\d+$/, "").replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isPlaceholderName(key: string, label: string | undefined): boolean {
  const l = (label ?? "").trim();
  if (!l) return true;
  if (l.toLowerCase() === key.toLowerCase()) return true;
  if (ACROBAT_DEFAULT.test(l)) return true;
  if (/·\s*box\s+\d+\s+of\s+\d+/i.test(l)) return true;
  // The label carries nothing the key did not already say.
  return l.toLowerCase() === prettifyKey(key).toLowerCase();
}

function fieldsOf(schemaJson: unknown): SchemaField[] {
  const s = schemaJson as { fields?: SchemaField[] } | null;
  return Array.isArray(s?.fields) ? s!.fields! : [];
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/?]+)/)?.[1] ?? "?";
  console.log(`db host: ${host}`);

  const models = await prisma.setupSheetModel.findMany({
    select: {
      id: true, name: true, slug: true, discipline: true, isAuthorized: true, schemaJson: true,
      sheetBlanks: {
        select: {
          id: true, status: true, isEdition: true, pageCount: true, setupDocumentId: true,
          boxNameSuggestionsJson: true, reviewedAt: true,
          setupDocument: { select: { storagePath: true, mimeType: true, originalFilename: true } },
        },
      },
      calibrations: { select: { id: true, name: true, verifiedAt: true } },
      _count: { select: { cars: true } },
    },
  });

  const rows = models.map((m) => {
    const fields = fieldsOf(m.schemaJson);
    const placeholders = fields.filter((f) => isPlaceholderName(f.key ?? "", f.displayLabel)).length;
    const blank = m.sheetBlanks.find((b) => !b.isEdition && b.status === "FILLABLE" && b.setupDocument)
      ?? m.sheetBlanks.find((b) => b.status === "FILLABLE" && b.setupDocument);
    const named = blank?.boxNameSuggestionsJson
      ? Object.keys(blank.boxNameSuggestionsJson as Record<string, unknown>).length
      : 0;
    return {
      modelId: m.id, name: m.name, slug: m.slug, discipline: m.discipline ?? "",
      cars: m._count.cars, calibrations: m.calibrations.length,
      fields: fields.length, placeholders,
      blankId: blank?.id ?? null, pages: blank?.pageCount ?? 0,
      storagePath: blank?.setupDocument?.storagePath ?? null,
      filename: blank?.setupDocument?.originalFilename ?? null,
      alreadySuggested: named,
    };
  });

  const all = process.argv.includes("--all");
  const queue = rows
    .filter((r) => all || (r.storagePath && r.placeholders > 0 && r.alreadySuggested === 0))
    .sort((a, b) => b.cars - a.cars || b.placeholders - a.placeholders);

  const limit = arg("limit") ? Number(arg("limit")) : queue.length;
  console.log(`\n${queue.length} sheets${all ? "" : " in the naming queue"} (of ${rows.length} chassis)\n`);
  console.log("cars  boxes  placeholder  pages  chassis");
  for (const r of queue.slice(0, limit)) {
    const flag = r.storagePath ? (r.pages > 1 ? " MULTI-PAGE" : "") : " NO-BLANK";
    console.log(
      `${String(r.cars).padStart(4)}  ${String(r.fields).padStart(5)}  ${String(r.placeholders).padStart(11)}  ${String(r.pages).padStart(5)}  ${r.name}${flag}`,
    );
  }

  const withBlank = rows.filter((r) => r.storagePath);
  const totals = {
    chassis: rows.length,
    withFillableBlank: withBlank.length,
    onePage: withBlank.filter((r) => r.pages <= 1).length,
    multiPage: withBlank.filter((r) => r.pages > 1).length,
    boxes: withBlank.reduce((n, r) => n + r.fields, 0),
    placeholders: withBlank.reduce((n, r) => n + r.placeholders, 0),
    raced: withBlank.filter((r) => r.cars > 0).length,
    racedPlaceholders: withBlank.filter((r) => r.cars > 0).reduce((n, r) => n + r.placeholders, 0),
  };
  console.log(`\ntotals: ${JSON.stringify(totals, null, 1)}`);

  const out = arg("json");
  if (out) {
    writeFileSync(out, JSON.stringify({ totals, sheets: queue }, null, 1));
    console.log(`wrote ${out}`);
  }
}

main().finally(() => prisma.$disconnect());
