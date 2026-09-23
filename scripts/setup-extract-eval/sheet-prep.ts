/**
 * Get one chassis ready for the naming helpers.
 *
 * Pulls the blank PDF out of the database, renders the page, cuts one picture per box (close-up
 * over wider view over whole page — see `buildComposite`), and splits the box list into small
 * batches. Everything lands in one work folder so a run can be stopped and picked up again.
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/setup-extract-eval/sheet-prep.ts --name="Xray X4'26" --work=<dir> [--batch=8]
 *
 * Writes into <dir>/<slug>/: blank.pdf, page.png, page-grid.jpg (for the layout helper),
 * manifest.json, crops/, batch-01.json…, sheet.json (what the assemble step needs).
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";
import { renderPdfFirstPageToPng } from "@/lib/setupDocuments/pdfServerRaster";

import { draftBlankV2, gridOverlayJpeg } from "./draft-blank-v2";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const name = arg("name"), modelId = arg("model-id");
  const workRoot = arg("work");
  const batchSize = Number(arg("batch") ?? 8);
  if (!workRoot || (!name && !modelId)) throw new Error("need --work and one of --name / --model-id");

  const model = await prisma.setupSheetModel.findFirst({
    where: modelId ? { id: modelId } : { name: { contains: name!, mode: "insensitive" } },
    select: {
      id: true, name: true, slug: true, discipline: true,
      sheetBlanks: {
        select: {
          id: true, status: true, isEdition: true, pageCount: true,
          setupDocument: { select: { storagePath: true, originalFilename: true, mimeType: true } },
        },
      },
    },
  });
  if (!model) throw new Error(`no chassis matching ${modelId ?? name}`);
  const blank = model.sheetBlanks.find((b) => !b.isEdition && b.status === "FILLABLE" && b.setupDocument)
    ?? model.sheetBlanks.find((b) => b.status === "FILLABLE" && b.setupDocument);
  if (!blank?.setupDocument) throw new Error(`${model.name}: no fillable blank PDF on file`);
  if (blank.pageCount > 1) console.log(`WARNING: ${model.name} blank has ${blank.pageCount} pages; only page 1 is mapped`);

  const dir = join(workRoot, model.slug);
  const cropsDir = join(dir, "crops");
  if (!existsSync(cropsDir)) mkdirSync(cropsDir, { recursive: true });

  const pdfBytes = await readBytesFromStorageRef(blank.setupDocument.storagePath);
  writeFileSync(join(dir, "blank.pdf"), pdfBytes);

  const page = await renderPdfFirstPageToPng(new Uint8Array(pdfBytes), { scale: 3 });
  writeFileSync(join(dir, "page.png"), page);
  const meta = await import("sharp").then((m) => m.default(page).metadata());
  const W = meta.width ?? 0, H = meta.height ?? 0;
  writeFileSync(join(dir, "page-grid.jpg"), await gridOverlayJpeg(page, W, H));

  const manifestPath = join(dir, "manifest.json");
  await draftBlankV2({
    pdfBytes: Buffer.from(pdfBytes), carName: `${model.name}${model.discipline ? ` (${model.discipline})` : ""}`,
    apiKey: "", model: "session", perCall: batchSize, concurrency: 1, scale: 3,
    cropsDir, manifestPath, composite: true, log: (s) => console.log(`   ${s}`),
  });

  const manifest = JSON.parse(await import("node:fs").then((m) => m.readFileSync(manifestPath, "utf8"))) as {
    carName: string; fields: Array<Record<string, unknown>>; universalParameters: Array<{ id: string; label: string }>;
  };

  const batches: string[] = [];
  for (let i = 0; i < manifest.fields.length; i += batchSize) {
    const n = String(batches.length + 1).padStart(2, "0");
    const file = join(dir, `batch-${n}.json`);
    writeFileSync(file, JSON.stringify({ carName: manifest.carName, fields: manifest.fields.slice(i, i + batchSize) }, null, 1));
    batches.push(file);
  }

  // The gridded page again, with every box outlined: the layout helper draws its blocks around the
  // boxes it can see, so a drawing and the callout boxes that point into it land in one block.
  {
    const sharpMod = (await import("sharp")).default;
    const gridded = await gridOverlayJpeg(page, W, H);
    const gm = await sharpMod(gridded).metadata();
    const gw = gm.width ?? 1600, gh = gm.height ?? 1;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${gw}" height="${gh}">`;
    for (const f of manifest.fields as Array<{ widgetRegions?: Array<{ x: number; y: number; w: number; h: number }> }>) {
      for (const r of f.widgetRegions ?? []) svg += `<rect x="${r.x * gw - 1}" y="${r.y * gh - 1}" width="${r.w * gw + 2}" height="${r.h * gh + 2}" fill="rgba(255,0,200,0.18)" stroke="#ff00c8" stroke-width="2"/>`;
    }
    svg += `</svg>`;
    await sharpMod(gridded).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 85 }).toFile(join(dir, "page-grid-boxes.jpg"));
  }

  writeFileSync(join(dir, "sheet.json"), JSON.stringify({
    modelId: model.id, name: model.name, slug: model.slug, discipline: model.discipline,
    blankId: blank.id, pageCount: blank.pageCount, pdf: join(dir, "blank.pdf"),
    fields: manifest.fields.length, batchSize, batches,
    universalParameters: manifest.universalParameters,
  }, null, 1));

  console.log(`\n${model.name}: ${manifest.fields.length} boxes → ${batches.length} batches of ${batchSize}`);
  console.log(`work folder: ${dir}`);
}

main().finally(() => prisma.$disconnect());
