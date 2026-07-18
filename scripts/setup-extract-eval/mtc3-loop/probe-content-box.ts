/** Probe row/col dark fractions for padded JPGs to tune detectContentBox. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

async function probe(label: string, buf: Buffer) {
  const SAMPLE_W = 800;
  const meta = await sharp(buf).metadata();
  const W0 = meta.width!;
  const H0 = meta.height!;
  const sampleH = Math.max(1, Math.round((SAMPLE_W * H0) / W0));
  const { data, info } = await sharp(buf)
    .removeAlpha()
    .grayscale()
    .resize(SAMPLE_W, sampleH, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowFrac = new Array<number>(height).fill(0);
  const colFrac = new Array<number>(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[y * width + x] ?? 255) < 200) {
        rowFrac[y]!++;
        colFrac[x]!++;
      }
    }
  }
  for (let y = 0; y < height; y++) rowFrac[y]! /= width;
  for (let x = 0; x < width; x++) colFrac[x]! /= height;

  const topN = rowFrac
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  const leftN = colFrac
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 8);
  console.log(`\n=== ${label} ${W0}x${H0} sample ${width}x${height} ===`);
  console.log(
    "top rows by darkFrac:",
    topN.map((x) => `y=${x.i}(${((x.i / height) * 100).toFixed(1)}%)=${x.v.toFixed(3)}`).join("  ")
  );
  console.log(
    "left cols by darkFrac:",
    leftN.map((x) => `x=${x.i}(${((x.i / width) * 100).toFixed(1)}%)=${x.v.toFixed(3)}`).join("  ")
  );

  // Outermost above thresholds
  for (const thr of [0.35, 0.28, 0.22, 0.18]) {
    let top = -1;
    for (let i = 0; i < height; i++) {
      if (rowFrac[i]! >= thr) {
        top = i;
        break;
      }
    }
    let left = -1;
    for (let i = 0; i < width; i++) {
      if (colFrac[i]! >= thr) {
        left = i;
        break;
      }
    }
    let bottom = -1;
    for (let i = height - 1; i >= 0; i--) {
      if (rowFrac[i]! >= thr) {
        bottom = i;
        break;
      }
    }
    let right = -1;
    for (let i = width - 1; i >= 0; i--) {
      if (colFrac[i]! >= thr) {
        right = i;
        break;
      }
    }
    console.log(
      `outermost@${thr}: top=${top} left=${left} bottom=${bottom} right=${right}`,
      top >= 0 && bottom > top && left >= 0 && right > left
        ? `box=${(((right - left + 1) / width) * 100).toFixed(1)}%x${(((bottom - top + 1) / height) * 100).toFixed(1)}%`
        : "INVALID"
    );
  }
}

async function main() {
  const dir = join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases");
  for (const name of [
    "case-01.jpg",
    "padded/pad-10pct.jpg",
    "padded/pad-18pct.jpg",
    "padded/pad-asymmetric.jpg",
  ]) {
    await probe(name, readFileSync(join(dir, name)));
  }
  const real = join(
    process.cwd(),
    "scripts/setup-extract-eval/gold/mugen-mtc3/files/mugen-test-setup.jpg"
  );
  await probe("mugen-test-setup.jpg", readFileSync(real));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
