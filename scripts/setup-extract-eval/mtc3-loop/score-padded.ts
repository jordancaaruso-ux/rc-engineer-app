/**
 * Stress-test content-box alignment for screenshot-like margins:
 * moderate letterbox, asymmetric letterbox, and ~1/3-of-screen (center/corner, light/dark desktop).
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/score-padded.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/score-padded.ts --with-ocr
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration,
  readImageThroughCalibration,
  scoreCase,
  detectContentBox,
  expectedAspectFromRef,
  type GoldCase,
} from "./mtc3-common";

const CASES = join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases");
const OUT = join(CASES, "padded");

async function padSymmetric(src: Buffer, padPct: number, name: string): Promise<Buffer> {
  const meta = await sharp(src).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const px = Math.round(Math.max(W, H) * padPct);
  const out = await sharp({
    create: {
      width: W + px * 2,
      height: H + px * 2,
      channels: 3,
      background: { r: 240, g: 240, b: 245 },
    },
  })
    .composite([{ input: src, left: px, top: px }])
    .jpeg({ quality: 85 })
    .toBuffer();
  writeFileSync(join(OUT, name), out);
  return out;
}

async function padAsymmetric(src: Buffer, name: string): Promise<Buffer> {
  const meta = await sharp(src).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const out = await sharp({
    create: {
      width: W + 180,
      height: H + 120,
      channels: 3,
      background: { r: 230, g: 230, b: 235 },
    },
  })
    .composite([{ input: src, left: 140, top: 40 }])
    .jpeg({ quality: 80 })
    .toBuffer();
  writeFileSync(join(OUT, name), out);
  return out;
}

/** Sheet fills ~1/3 of the frame (PetitRC-in-browser class). */
async function padThirdScreen(
  src: Buffer,
  name: string,
  mode: "center" | "corner",
  bg: "light" | "dark"
): Promise<Buffer> {
  const meta = await sharp(src).metadata();
  const W = meta.width!;
  const H = meta.height!;
  const canvasW = W * 3;
  const canvasH = H * 3;
  const left = mode === "center" ? W : 48;
  const top = mode === "center" ? H : 48;
  const background =
    bg === "dark" ? { r: 40, g: 44, b: 52 } : { r: 245, g: 245, b: 248 };
  const out = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background },
  })
    .composite([{ input: src, left, top }])
    .jpeg({ quality: 85 })
    .toBuffer();
  writeFileSync(join(OUT, name), out);
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  const expectedAspect = expectedAspectFromRef(ref);
  console.log("ref contentBox=", JSON.stringify(ref?.contentBox ?? null));
  console.log("expectedAspect=", expectedAspect);

  const gold = JSON.parse(readFileSync(join(CASES, "case-01.gold.json"), "utf8")) as GoldCase;
  const base = readFileSync(join(CASES, "case-01.jpg"));
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const withOcr = process.argv.includes("--with-ocr");

  const variants: Array<[string, Buffer]> = [
    ["pad-10pct.jpg", await padSymmetric(base, 0.1, "pad-10pct.jpg")],
    ["pad-18pct.jpg", await padSymmetric(base, 0.18, "pad-18pct.jpg")],
    ["pad-asymmetric.jpg", await padAsymmetric(base, "pad-asymmetric.jpg")],
    ["third-center-light.jpg", await padThirdScreen(base, "third-center-light.jpg", "center", "light")],
    ["third-center-dark.jpg", await padThirdScreen(base, "third-center-dark.jpg", "center", "dark")],
    ["third-corner-light.jpg", await padThirdScreen(base, "third-corner-light.jpg", "corner", "light")],
    ["third-corner-dark.jpg", await padThirdScreen(base, "third-corner-dark.jpg", "corner", "dark")],
  ];

  for (const [name, jpg] of variants) {
    const box = await detectContentBox(jpg, { expectedAspect });
    console.log(
      `\n${name} contentBox=`,
      box
        ? `${(box.wPct * 100).toFixed(0)}%×${(box.hPct * 100).toFixed(0)}% @ (${(box.xPct * 100).toFixed(0)}%,${(box.yPct * 100).toFixed(0)}%)`
        : null
    );
    const read = await readImageThroughCalibration(jpg, live.imageCalibration, apiKey, {
      skipOcr: !withOcr,
    });
    const verdicts = scoreCase(gold, read, live.imageCalibration).filter(
      (v) => withOcr || v.kind !== "text"
    );
    const fails = verdicts.filter((v) => !v.ok);
    console.log(
      `${name}: ${verdicts.length - fails.length}/${verdicts.length}`,
      fails.length ? "FAILS:" : "OK"
    );
    for (const f of fails.slice(0, 20)) {
      console.log(
        `  FAIL ${f.failMode} ${f.kind} ${f.key} gold=${JSON.stringify(f.gold)} read=${JSON.stringify(f.read)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
