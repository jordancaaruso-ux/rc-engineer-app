/**
 * Generate the MTC3 synthetic test set:
 *   fill the editable AcroForm with realistic per-field values (mutated from Soren's real
 *   sheet + the CW prefills, seeded/reproducible, ~20% deliberate blanks) -> render page 1
 *   with headless Chrome/pdfjs -> degrade to screenshot-like JPGs -> gold extracted back
 *   from the filled PDF itself (single source of truth; catches any set() failures).
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/gen-synthetics.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PDFDocument, PDFCheckBox, PDFTextField, PDFName, StandardFonts } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import type { ImageRegion } from "@/lib/setupCalibrations/types";
import { renderPdfPage1ToPng } from "../renderPdfToImage";
import {
  EDITABLE_PDF, SOREN_PDF,
  loadLiveCalibration, loadAcroGeometry, extractGoldFromFilledPdf, regionsMatch,
  type LiveCalibration, type AcroFieldInfo,
} from "./mtc3-common";

const CASES_DIR = join(process.cwd(), "scripts", "setup-extract-eval", "mtc3-loop", "cases");
const N_CASES = 6;
// (width, jpeg quality) per case — bracketing real screenshots like mugen test setup.jpg (1210px).
// The grayscale case turns the red marks grey-black, exercising the black-style gap path
// (PetitRC-style sheets) with known gold.
const DEGRADE: Array<{ width: number; quality: number; grayscale?: boolean }> = [
  { width: 1210, quality: 80 },
  { width: 1000, quality: 70 },
  { width: 1400, quality: 85 },
  { width: 1210, quality: 90 },
  { width: 1100, quality: 75 },
  { width: 1300, quality: 80, grayscale: true },
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STRING_POOLS: Record<string, string[]> = {
  driver: ["Jordan Caruso", "Alex Meyer", "Sam Okafor", "Luca Bianchi"],
  track: ["ETS Round 3 Mulhouse", "Apex Raceway", "MRT Indoor Carpet", "Vaasa RC Ring"],
  race: ["Club Race RD2", "ETS Warmup", "Nationals Q3"],
  tires: ["Hudy A2", "RCK", "Volante V5"],
  additive: ["Hudy Hybrid", "Carpet 3", "SXT 3.0"],
  battery: ["9400 LRP", "Marka 7000 - 200C", "Gens Ace 6800"],
  motor: ["17.5 RCK", "Bandit G4R 13.5", "Hobbywing V10 G4"],
  servo: ["Power-HD S25", "Team Powers SRS V4", "Sanwa PGS-CL2"],
  transmitter: ["Sanwa M17", "Futaba 10PX"],
  receiver: ["RX-493i", "Team Powers SRS V4"],
  chassis_type: ["Alu", "Carbon"],
  bodyshell_and_wing_type: ["Mach 1", "A2R", "Zonda"],
  info: ["Fast in the middle sector", "Push on entry, free on exit"],
};

function poolFor(key: string): string[] | null {
  return STRING_POOLS[key] ?? null; // exact key only — "track_temperature" must not draw track names
}

/** Jitter a value while preserving its format: numeric part +/- steps, suffix kept. */
function mutateValue(example: string, rnd: () => number): string {
  const m = example.match(/^([+-]?)(\d+(?:[.,]\d+)?)(.*)$/);
  if (m) {
    const sign = m[1] ?? "";
    const numStr = m[2]!.replace(",", ".");
    const suffix = m[3] ?? "";
    const dp = numStr.includes(".") ? numStr.split(".")[1]!.length : 0;
    const step = dp > 0 ? Math.pow(10, -dp) * (dp === 2 ? 25 : 1) : 1; // "4.25" steps by .25, "3.6" by .1, "450" by 1
    const base = Number(numStr);
    const jitter = (Math.floor(rnd() * 7) - 3) * step * (dp === 0 && base >= 50 ? 10 : 1);
    let v = base + jitter;
    if (base >= 0 && v < 0) v = base; // keep sign class stable
    const out = dp > 0 ? v.toFixed(dp) : String(Math.round(v));
    return `${sign === "-" ? "-" : sign}${out}${suffix}`;
  }
  return example;
}

type ChosenMark = { key: string; value: string; region: ImageRegion };

async function fillCase(input: {
  caseIndex: number;
  live: LiveCalibration;
  geo: Map<string, AcroFieldInfo>;
  examplesByKey: Map<string, string[]>;
  /** When true, DON'T fill PDF checkboxes; return the chosen options so the caller composites
   *  faithful solid BLACK marks on the render (PetitRC-style) instead of the PDF's red glyphs. */
  blackMarks?: boolean;
}): Promise<{ pdfBytes: Buffer; chosenMarks: ChosenMark[] }> {
  const rnd = mulberry32(1000 + input.caseIndex * 77);
  const pdf = await PDFDocument.load(readFileSync(EDITABLE_PDF), { ignoreEncryption: true });
  const form = pdf.getForm();
  const chosenMarks: ChosenMark[] = [];

  // 1) Clear everything (the CW base ships with 44 prefilled values).
  for (const f of form.getFields()) {
    try {
      if (f instanceof PDFTextField) f.setText("");
      else if (f instanceof PDFCheckBox) f.uncheck();
    } catch { /* leave as-is */ }
  }

  // 2) Text fields: ~80% filled with a mutated example, ~20% deliberately blank.
  for (const calField of input.live.imageCalibration.fields) {
    if (calField.kind !== "text") continue;
    const pdfName = input.live.mappings[calField.key]?.pdfFieldName;
    if (!pdfName) continue;
    if (rnd() < 0.2) continue; // stays blank; gold will record "".
    const examples = input.examplesByKey.get(calField.key) ?? [];
    const pool = poolFor(calField.key);
    let value: string;
    if (pool && (examples.length === 0 || rnd() < 0.7)) value = pool[Math.floor(rnd() * pool.length)]!;
    else if (examples.length > 0) value = mutateValue(examples[Math.floor(rnd() * examples.length)]!, rnd);
    else value = (Math.round(rnd() * 60) / 10).toFixed(1);
    try {
      const f = form.getField(pdfName);
      if (f instanceof PDFTextField) f.setText(value);
    } catch { /* gold self-corrects from the saved pdf */ }
  }

  // 3) Choice groups: mark one option ~75% of the time (multi: 1-2 options ~85%).
  //    Option region -> acro widget by exact geometry -> set that widget's on-value.
  const markWidget = (region: ImageRegion): boolean => {
    for (const acro of input.geo.values()) {
      if (acro.kind !== "checkbox") continue;
      for (const w of acro.widgets) {
        if (!regionsMatch(w.region, region) || !w.onValue) continue;
        try {
          const f = form.getField(acro.name);
          if (f instanceof PDFCheckBox) {
            f.acroField.setValue(PDFName.of(w.onValue));
            return true;
          }
        } catch { return false; }
      }
    }
    return false;
  };
  const mark = (calKey: string, opt: { value: string; region: ImageRegion }) => {
    if (input.blackMarks) chosenMarks.push({ key: calKey, value: opt.value, region: opt.region });
    else markWidget(opt.region);
  };
  for (const calField of input.live.imageCalibration.fields) {
    if (calField.kind !== "singleChoiceGroup" && calField.kind !== "multiSelectGroup") continue;
    const opts = (calField as { options: Array<{ value: string; region: ImageRegion }> }).options;
    if (calField.kind === "singleChoiceGroup") {
      if (rnd() < 0.25) continue; // unmarked group: must import nothing.
      mark(calField.key, opts[Math.floor(rnd() * opts.length)]!);
    } else {
      if (rnd() < 0.15) continue;
      const n = rnd() < 0.6 ? 1 : 2;
      const picked = new Set<number>();
      while (picked.size < Math.min(n, opts.length)) picked.add(Math.floor(rnd() * opts.length));
      for (const i of picked) mark(calField.key, opts[i]!);
    }
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return { pdfBytes: Buffer.from(await pdf.save()), chosenMarks };
}

/** Composite faithful solid black marks (PetitRC style) onto a rendered sheet at chosen option
 *  regions. Circles roughly fill the checkbox, like a hand-inked dot. */
async function compositeBlackMarks(png: Buffer, marks: ChosenMark[]): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 1684;
  const H = meta.height ?? 1190;
  const circles = marks
    .map((m) => {
      const cx = (m.region.xPct + m.region.wPct / 2) * W;
      const cy = (m.region.yPct + m.region.hPct / 2) * H;
      const r = 0.42 * Math.min(m.region.wPct * W, m.region.hPct * H);
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="#111111"/>`;
    })
    .join("");
  const svg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${circles}</svg>`);
  return sharp(png).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
}

async function main() {
  mkdirSync(CASES_DIR, { recursive: true });
  const live = await loadLiveCalibration();
  const geo = await loadAcroGeometry(readFileSync(EDITABLE_PDF));

  // Example values per key, from Soren's filled sheet + the CW prefills.
  const examplesByKey = new Map<string, string[]>();
  for (const src of [SOREN_PDF, EDITABLE_PDF]) {
    const gold = await extractGoldFromFilledPdf(readFileSync(src), live);
    for (const [k, v] of Object.entries(gold.values)) {
      if (!v) continue;
      const arr = examplesByKey.get(k) ?? [];
      arr.push(v);
      examplesByKey.set(k, arr);
    }
  }
  console.log(`Example values for ${examplesByKey.size} keys.`);

  // Soren case: real human-filled PDF, rendered.
  {
    const sorenBytes = readFileSync(SOREN_PDF);
    const gold = await extractGoldFromFilledPdf(sorenBytes, live);
    const png = await renderPdfPage1ToPng(sorenBytes, 1684);
    const jpg = await sharp(png).resize(1210).jpeg({ quality: 80 }).toBuffer();
    writeFileSync(join(CASES_DIR, "case-soren.jpg"), jpg);
    writeFileSync(join(CASES_DIR, "case-soren.gold.json"), JSON.stringify(gold, null, 2));
    console.log(`case-soren: ${Object.values(gold.values).filter(Boolean).length} filled fields, ${gold.unscoredKeys.length} unscored`);
  }

  for (let i = 0; i < N_CASES; i++) {
    const name = `case-${String(i + 1).padStart(2, "0")}`;
    const d = DEGRADE[i % DEGRADE.length]!;
    const blackMarks = Boolean(d.grayscale);
    const { pdfBytes, chosenMarks } = await fillCase({ caseIndex: i, live, geo, examplesByKey, blackMarks });
    const gold = await extractGoldFromFilledPdf(pdfBytes, live);
    // Black-style case: choices came from composited marks, not PDF checkboxes — fold them into gold.
    if (blackMarks) {
      const byKey = new Map<string, string[]>();
      for (const m of chosenMarks) byKey.set(m.key, [...(byKey.get(m.key) ?? []), m.value]);
      for (const f of live.imageCalibration.fields) {
        if (f.kind !== "singleChoiceGroup" && f.kind !== "multiSelectGroup") continue;
        gold.values[f.key] = (byKey.get(f.key) ?? []).join(",");
      }
    }
    let png = await renderPdfPage1ToPng(pdfBytes, 1684);
    if (blackMarks) png = await compositeBlackMarks(await sharp(png).grayscale().png().toBuffer(), chosenMarks);
    const jpg = await sharp(png).resize(d.width).jpeg({ quality: d.quality }).toBuffer();
    writeFileSync(join(CASES_DIR, `${name}.filled.pdf`), pdfBytes);
    writeFileSync(join(CASES_DIR, `${name}.jpg`), jpg);
    writeFileSync(join(CASES_DIR, `${name}.gold.json`), JSON.stringify(gold, null, 2));
    console.log(
      `${name}: ${Object.values(gold.values).filter(Boolean).length} filled fields ` +
        `(${d.width}px q${d.quality}${blackMarks ? " black-marks" : ""}), ${gold.unscoredKeys.length} unscored`
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
