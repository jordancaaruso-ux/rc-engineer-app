import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { readBytesFromStorageRef } from "@/lib/setupDocuments/storage";

type Box = { name: string; page: number; x: number; y: number; w: number; h: number; type: string };

async function listBoxes(bytes: Uint8Array): Promise<Box[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = doc.getForm();
  const pages = doc.getPages();
  const boxes: Box[] = [];
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    for (const w of widgets) {
      const rect = w.getRectangle();
      let pageIndex = -1;
      const pageRef = w.P();
      if (pageRef) pageIndex = pages.findIndex((p) => p.ref === pageRef);
      boxes.push({
        name: field.getName(),
        page: pageIndex,
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
        type: field.constructor.name,
      });
    }
  }
  return boxes;
}

const key = (b: Box) => `${b.page}:${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.w)}:${Math.round(b.h)}`;

function nearest(b: Box, pool: Box[], tol: number): Box | null {
  let best: Box | null = null;
  let bestD = Infinity;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  for (const o of pool) {
    if (o.page !== b.page) continue;
    const d = Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy);
    if (d < bestD) { bestD = d; best = o; }
  }
  return bestD <= tol ? best : null;
}

async function main() {
  const oldBytes = new Uint8Array(await readFile(path.join(process.cwd(), "public", "setup-sheets", "A800RR.pdf")));
  const newBytes = new Uint8Array(
    await readBytesFromStorageRef(
      "https://gj8pbhsoszmcnzvk.private.blob.vercel-storage.com/setup-documents/2026-08-16-89a19406-0321-4f48-b91e-50b5f4f560b5.pdf",
    ),
  );
  await writeFile(path.join(process.cwd(), "scripts", "tmp-lucas-setup2.pdf"), newBytes);

  const oldBoxes = await listBoxes(oldBytes);
  const newBoxes = await listBoxes(newBytes);
  console.log(`old boxes: ${oldBoxes.length}, new boxes: ${newBoxes.length}`);

  const unusedOld = new Set(oldBoxes);
  let paired = 0;
  let sameName = 0;
  const newOnly: Box[] = [];
  for (const b of newBoxes) {
    const match = nearest(b, [...unusedOld], 4);
    if (!match) { newOnly.push(b); continue; }
    unusedOld.delete(match);
    paired++;
    if (match.name === b.name) sameName++;
  }
  console.log(`paired by position (±4pt): ${paired} of ${newBoxes.length} new boxes`);
  console.log(`  of which kept the same field name: ${sameName}`);
  console.log(`genuinely NEW boxes (nothing near them on the old sheet): ${newOnly.length}`);
  for (const b of newOnly) console.log(`  ${key(b)}  ${JSON.stringify(b.name)} [${b.type}]`);
  console.log(`old boxes with no new counterpart: ${unusedOld.size}`);
  for (const b of unusedOld) console.log(`  ${key(b)}  ${JSON.stringify(b.name)} [${b.type}]`);
}

main();
