import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const DIR = String.raw`C:\Users\Jordan\AppData\Local\Temp\claude\c--Users-Jordan-rc-engineer-app\c000bdfb-2a4a-4c9d-95a4-1d935a0ab9d4\scratchpad\sheets`;

// Regions in PDF points, TOP-DOWN y (page 595.28 x 841.89), scale 3 at render time.
const REGIONS: Record<string, { x: number; y: number; w: number; h: number }> = {
  footer: { x: 290, y: 600, w: 300, h: 235 },
  chassis: { x: 5, y: 595, w: 300, h: 60 },
  header: { x: 290, y: 30, w: 300, h: 80 },
  bumperweights: { x: 5, y: 540, w: 290, h: 70 },
};

async function crop(label: string) {
  const img = await loadImage(path.join(DIR, `${label}-p1.png`));
  for (const [name, r] of Object.entries(REGIONS)) {
    const s = 3;
    const canvas = createCanvas(r.w * s, r.h * s);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, r.x * s, r.y * s, r.w * s, r.h * s, 0, 0, r.w * s, r.h * s);
    await writeFile(path.join(DIR, `${label}-${name}.png`), canvas.toBuffer("image/png"));
  }
}

async function main() {
  await crop("original");
  await crop("lucas");
  console.log("done");
}

main();
