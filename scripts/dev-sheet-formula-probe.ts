/**
 * dev-sheet-formula-probe.ts — READ-ONLY. Do the manufacturers' blank PDFs carry their OWN
 * calculations, or are the formulas ours?
 *
 * A fillable PDF can compute a field from other fields: the AcroForm dict holds a calculation
 * ORDER (`/CO`), and each computed field carries an additional-action dict (`/AA`) with a
 * calculate entry (`/C`) whose `/JS` is the actual script — usually `AFSimple_Calculate` for a
 * sum/product, or free-hand JavaScript for anything else. Acrobat runs those; we never have.
 *
 * The question this answers (founder, 2026-08-26): "is this reading the formula directly from the
 * sheet? would derived values on other sheets be right?"
 *
 *   npx dotenv-cli -e .env.local -- node --conditions=react-server --import tsx \
 *     scripts/dev-sheet-formula-probe.ts
 */
import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFString,
  PDFHexString,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

const DUMP = process.argv.includes("--dump");

function textOf(v: unknown): string {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  // Anything longer than a line is stored as a COMPRESSED STREAM, not a string — which is why a
  // first pass reported the two spring-rate scripts as "non-text" and only the one-line ratio as
  // readable. Inflate it.
  if (v instanceof PDFRawStream) {
    try {
      return Buffer.from(decodePDFRawStream(v).decode()).toString("utf8");
    } catch {
      return "(stream would not inflate)";
    }
  }
  return "";
}

/** Walk every field in the AcroForm tree, including kids. */
function walkFields(node: PDFDict, doc: PDFDocument, out: PDFDict[], depth = 0) {
  if (depth > 12) return;
  const kids = node.lookup(PDFName.of("Kids"));
  if (kids instanceof PDFArray) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookup(i);
      if (kid instanceof PDFDict) walkFields(kid, doc, out, depth + 1);
    }
  }
  if (node.has(PDFName.of("T"))) out.push(node);
}

async function probe(label: string, bytes: Buffer) {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (e) {
    console.log(`\n${label}\n  !! could not open: ${(e as Error).message.slice(0, 90)}`);
    return;
  }
  const acro = doc.catalog.lookup(PDFName.of("AcroForm"));
  if (!(acro instanceof PDFDict)) {
    console.log(`\n${label}\n  no AcroForm at all`);
    return;
  }

  const co = acro.lookup(PDFName.of("CO"));
  const calcOrder = co instanceof PDFArray ? co.size() : 0;

  const roots = acro.lookup(PDFName.of("Fields"));
  const fields: PDFDict[] = [];
  if (roots instanceof PDFArray) {
    for (let i = 0; i < roots.size(); i++) {
      const f = roots.lookup(i);
      if (f instanceof PDFDict) walkFields(f, doc, fields);
    }
  }

  const scripts: string[] = [];
  const formats: string[] = [];
  let formatActions = 0;
  for (const f of fields) {
    const aa = f.lookup(PDFName.of("AA"));
    if (!(aa instanceof PDFDict)) continue;
    const fmt = aa.lookup(PDFName.of("F"));
    if (fmt instanceof PDFDict) {
      formatActions++;
      // How the sheet DISPLAYS the number — `AFNumber_Format(decimals, sepStyle, negStyle, …)`.
      // This is what says whether a computed rate reads 61.4 or 61.393 on the driver's own paper.
      const name = textOf(f.lookup(PDFName.of("T"))) || "(unnamed)";
      formats.push(`${name}: ${textOf(fmt.lookup(PDFName.of("JS"))).replace(/\s+/g, " ").trim()}`);
    }
    const calc = aa.lookup(PDFName.of("C"));
    if (!(calc instanceof PDFDict)) continue;
    const js = calc.lookup(PDFName.of("JS"));
    const name = textOf(f.lookup(PDFName.of("T"))) || "(unnamed)";
    // Captured WHOLE. Truncating here is what made a 3 KB lookup table look like a 140-character
    // one-liner on the first pass — the printer below is the only place allowed to shorten.
    scripts.push(`${name}: ${textOf(js) || "(unreadable)"}`);
  }

  // Document-level JavaScript (Names/JavaScript) — where a sheet would put shared helpers.
  const names = doc.catalog.lookup(PDFName.of("Names"));
  let docLevelJs = 0;
  if (names instanceof PDFDict) {
    const jsTree = names.lookup(PDFName.of("JavaScript"));
    if (jsTree instanceof PDFDict) {
      const arr = jsTree.lookup(PDFName.of("Names"));
      if (arr instanceof PDFArray) docLevelJs = arr.size() / 2;
    }
  }

  console.log(`\n${label}`);
  console.log(`  fields: ${fields.length} · calculation order (/CO): ${calcOrder} entries`);
  console.log(`  fields with a CALCULATE action: ${scripts.length} · with a format action: ${formatActions}`);
  console.log(`  document-level JavaScript blocks: ${docLevelJs}`);
  for (const f of formats) console.log(`    [format] ${f}`);
  for (const s of scripts) {
    const [n, ...rest] = s.split(": ");
    const body = rest.join(": ");
    console.log(`    · ${n} — ${body.length} chars of script`);
    if (DUMP) {
      console.log(
        body
          .split("\n")
          .map((l) => "        " + l)
          .join("\n")
      );
    } else {
      console.log(`        ${body.replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
}

async function main() {
  const blanks = await prisma.setupSheetBlank.findMany({
    where: { setupDocumentId: { not: null } },
    select: {
      id: true,
      isEdition: true,
      setupSheetModel: { select: { name: true, slug: true } },
      setupDocument: { select: { storagePath: true, originalFilename: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  console.log(`blanks with a stored PDF: ${blanks.length}`);

  for (const b of blanks) {
    const path = b.setupDocument?.storagePath;
    if (!path) continue;
    const name = b.setupSheetModel?.name ?? "(no chassis)";
    const label = `── ${name}${b.isEdition ? " [edition]" : ""} — ${b.setupDocument?.originalFilename ?? "?"}`;
    try {
      await probe(label, await readBytesFromStorageRef(path));
    } catch (e) {
      console.log(`\n${label}\n  !! could not fetch: ${(e as Error).message.slice(0, 90)}`);
    }
  }
}

main().finally(() => prisma.$disconnect());
