import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSetupDocumentFile } from "../src/lib/setupDocuments/parser.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/parseSetupDocument.mjs <path-to-pdf-or-image>");
  process.exit(1);
}

const abs = path.resolve(process.cwd(), filePath);
const bytes = await readFile(abs);
const name = path.basename(abs);
const ext = name.toLowerCase().split(".").pop();
const mime =
  ext === "pdf"
    ? "application/pdf"
    : ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";

const file = new File([bytes], name, { type: mime });
const sourceType = mime === "application/pdf" ? "PDF" : "IMAGE";

console.log(`[dev-parse] file=${name} bytes=${bytes.length} mime=${mime} sourceType=${sourceType}`);
const t0 = Date.now();

const result = await parseSetupDocumentFile({
  file,
  sourceType,
  debug: {
    filename: name,
    onStage: async (stage, event) => {
      console.log(`[dev-parse] ${event} ${stage}`);
    },
    onInfo: async (stage, data) => {
      const safe = JSON.stringify(data);
      console.log(`[dev-parse] info ${stage} ${safe.length > 1200 ? safe.slice(0, 1200) + "…(truncated)" : safe}`);
    },
  },
});

console.log(`[dev-parse] done in ${Date.now() - t0}ms status=${result.parseStatus} mapped=${result.mappedFieldCount}`);
if (result.note) console.log(`[dev-parse] note=${result.note}`);

