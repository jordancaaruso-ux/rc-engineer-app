/**
 * Score the Ronald PetitRC screenshot against hand gold; dump failing key crops.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/setup-extract-eval/mtc3-loop/score-ronald.ts
 *   Flags: --choices-only  --dump-fails
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import {
  loadLiveCalibration,
  readImageThroughCalibration,
  scoreCase,
  alignToReference,
  detectContentBox,
  expectedAspectFromRef,
  type GoldCase,
} from "./mtc3-common";
import type { ImageRegion } from "@/lib/setupCalibrations/types";

const SRC_CANDIDATES = [
  "scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-petitrc.png",
  join(
    process.env.USERPROFILE ?? "",
    ".cursor/projects/c-Users-Jordan-Documents-rc-engineer-app/assets",
    "c__Users_Jordan_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images_Screenshot_2026-07-18_125141-52e0b16d-9b36-4e9c-93a8-210f91d39dcc.png"
  ),
];

/** Hand gold from founder screenshot (Ronald / Galenare / digitally filled). Keys = live cal. */
const RONALD_GOLD: GoldCase = {
  unscoredKeys: [],
  values: {
    driver: "Ronald",
    // Choice gold verified from per-option crops on setup.jpg (red fill / red X).
    track: "Galenaro RC, Korea",
    setup_date: "12.10.25",
    race: "AOC",
    result: "1st",
    transmitter: "Flysky Noble Pro+",
    receiver: "Flysky FGr4D",
    servo: "Highest L250",
    steering_expo: "-24",
    battery: "LRP 6500",
    motor: "4.5t",
    pinion: "24",
    spur: "90",
    tires: "Sweep D36",
    additive: "MG Yellow",
    warmer_c: "75",
    warmer_time: "12",
    track_surface: "asphalt",
    layout: "technical",
    traction: "medium",
    camber_front: "1.5",
    toe_front: "1.5",
    droop_front: "24",
    ride_height_front: "4.6",
    caster_front: "4",
    uptravel_limit_front: "1.5",
    spring_front: "4.5",
    shock_oil_front: "650",
    shock_rod_extension_front: "7.5",
    shock_angle_front: "f_2_0mm",
    camber_rear: "1.5",
    toe_rear: "3.2",
    droop_rear: "22.8",
    ride_height_rear: "4.8",
    caster_rear: "3",
    uptravel_limit_rear: "1.3",
    spring_rear: "4.25",
    shock_oil_rear: "400",
    shock_rod_extension_rear: "7.5",
    shock_angle_rear: "f_2_0mm",
    active_fixed: "fixed",
    active_fixed_rear: "active",
    arb_front: "f_1_2",
    arb_rear: "f_1_2",
    diff_height_front: "high",
    diff_height_rear: "high",
    hex_width_front: "0",
    hex_width_rear: "0",
    piston_type_front: "piston_opt",
    // Rear piston boxes look unmarked on this sheet (empty crops).
    piston_type_rear: "",
    motor_mount_screws: "3,4",
    chassis_type: "Alu",
    car_weight: "1305",
    weight_balance_f_r: "49.5 / 50.5",
    bodyshell_and_wing_type: "Twister UL & Speciale L",
    front_body_post_height: "67",
    above_rear_wheel_arch_height: "94",
    diff_oil: "6000",
    diff_oil_g: "1.4",
    ff_shims: "0.5",
    fr_shims: "1",
    rf_shims: "1",
    rr_shims: "2",
  },
};

async function dumpKeyCrops(
  aligned: Buffer,
  ref: { widthPx: number; heightPx: number },
  fields: Array<{ key: string; kind: string; region?: ImageRegion; options?: Array<{ value: string; region: ImageRegion }> }>,
  keys: string[],
  outDir: string
) {
  mkdirSync(outDir, { recursive: true });
  for (const key of keys) {
    const f = fields.find((x) => x.key === key);
    if (!f) continue;
    const regions =
      f.kind === "text" || f.kind === "checkbox"
        ? [{ tag: key, region: f.region! }]
        : (f.options ?? []).map((o) => ({ tag: `${key}__${o.value}`, region: o.region }));
    for (const { tag, region } of regions.slice(0, 8)) {
      const px = {
        left: Math.round(region.xPct * ref.widthPx),
        top: Math.round(region.yPct * ref.heightPx),
        width: Math.max(1, Math.round(region.wPct * ref.widthPx)),
        height: Math.max(1, Math.round(region.hPct * ref.heightPx)),
      };
      try {
        const crop = await sharp(aligned).extract(px).resize(px.width * 4).png().toBuffer();
        writeFileSync(join(outDir, `ronald--${tag}.png`), crop);
      } catch (e) {
        console.log(`crop fail ${tag}: ${(e as Error).message}`);
      }
    }
  }
}

async function main() {
  const preferFull = join(
    process.cwd(),
    "scripts/setup-extract-eval/mtc3-loop/cases/padded/ronald-setup-full.jpg"
  );
  const src =
    (existsSync(preferFull) ? preferFull : null) ?? SRC_CANDIDATES.find((p) => existsSync(p));
  if (!src) throw new Error("Ronald screenshot not found");
  const destDir = join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/cases/padded");
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, "ronald-petitrc.png");
  if (src !== dest) copyFileSync(src, dest);
  writeFileSync(join(destDir, "ronald.gold.json"), JSON.stringify(RONALD_GOLD, null, 2));

  const live = await loadLiveCalibration();
  const ref = live.imageCalibration.reference;
  const img = readFileSync(dest);
  const meta = await sharp(img).metadata();
  const box = await detectContentBox(img, { expectedAspect: expectedAspectFromRef(ref) });
  console.log("src", src);
  console.log("size", meta.width, "x", meta.height, "aspect", ((meta.width ?? 1) / (meta.height ?? 1)).toFixed(3));
  console.log("ref", ref.widthPx, "x", ref.heightPx, "aspect", (ref.widthPx / ref.heightPx).toFixed(3));
  console.log("contentBox", box);

  const choicesOnly = process.argv.includes("--choices-only");
  const apiKey = process.env.OPENAI_API_KEY!.trim();
  const read = await readImageThroughCalibration(img, live.imageCalibration, apiKey, {
    skipOcr: choicesOnly,
  });

  // Only score keys we put in gold (and that exist on the calibration).
  const goldKeys = new Set(Object.keys(RONALD_GOLD.values));
  const calKeys = new Set(live.imageCalibration.fields.map((f) => f.key));
  const missingOnCal = [...goldKeys].filter((k) => !calKeys.has(k));
  if (missingOnCal.length) console.log("gold keys missing on cal:", missingOnCal.join(", "));

  const verdicts = scoreCase(RONALD_GOLD, read, live.imageCalibration).filter((v) => goldKeys.has(v.key));
  const fails = verdicts.filter((v) => !v.ok);
  console.log(`\n${verdicts.length - fails.length}/${verdicts.length} (${choicesOnly ? "choices+gold-text skipped" : "gold keys"})`);
  for (const f of fails) {
    console.log(`  FAIL ${f.failMode?.padEnd(13)} ${f.kind.padEnd(8)} ${f.key.padEnd(28)} gold=${JSON.stringify(f.gold)} read=${JSON.stringify(f.read)}`);
  }
  for (const v of verdicts.filter((x) => x.ok).slice(0, 15)) {
    console.log(`  OK   ${v.kind.padEnd(8)} ${v.key.padEnd(28)} ${JSON.stringify(v.read)}`);
  }

  if (process.argv.includes("--dump-fails") || fails.length) {
    const aligned = await alignToReference(img, ref);
    await sharp(aligned).jpeg({ quality: 90 }).toFile(join(destDir, "ronald-aligned.jpg"));
    const failKeys = fails.map((f) => f.key);
    const sampleKeys = [
      ...failKeys.slice(0, 12),
      "camber_front",
      "ride_height_front",
      "spring_front",
      "shock_oil_front",
      "driver",
      "track",
    ];
    await dumpKeyCrops(
      aligned,
      ref,
      live.imageCalibration.fields as never,
      [...new Set(sampleKeys)],
      join(process.cwd(), "scripts/setup-extract-eval/mtc3-loop/crops")
    );
    console.log("dumped crops + aligned jpg");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
