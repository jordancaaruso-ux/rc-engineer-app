/**
 * Headless re-validation of the ported crossing detector against the 2026-07-21 offline run.
 *
 * There is no UI in this path on purpose: this is the step that decides whether the port is
 * faithful, and it has to be answerable without a browser, a click, or a judgement call.
 *
 * Three independent checks, weakest to strongest:
 *   1. Lap-time self-check  - gaps between detected start/finish crossings must reproduce the
 *      transponder lap times. Needs no reference data at all.
 *   2. Reference agreement  - detected times vs what the Python probe detected for the same
 *      target (`rc-autosnap-results/autosnap-me/loop-results-b22-t14.json`).
 *   3. Detection rate       - corners found vs corners the probe found, including the misses:
 *      reproducing a MISS matters as much as reproducing a hit.
 *
 * Usage:
 *   npx tsx scripts/find-crossings-validate.ts [--lines sf|corners|all] [--limit N] [--out FILE]
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  WindowScanner,
  eventsFromSamples,
  resultFromSamples,
  resultFromWindow,
  type TrackedResult,
} from "../src/lib/videoAnalysis/findCrossings/detector";
import { bandMask, blurKernelForLine, roiFor } from "../src/lib/videoAnalysis/findCrossings/geometry";
import { spansFromMask } from "../src/lib/videoAnalysis/findCrossings/spans";
import {
  bandFrameDiffs,
  calibrateFromDiffs,
  type LineCalibration,
} from "../src/lib/videoAnalysis/findCrossings/calibrate";
import { refineByChaining } from "../src/lib/videoAnalysis/findCrossings/refine";
import { WINDOW_SEC, cornerTargets, sfBoundaryTargets } from "../src/lib/videoAnalysis/findCrossings/predict";
import { RECIPE_B22_T14, RECIPE_VARIANTS } from "../src/lib/videoAnalysis/findCrossings/types";
import { bandHalfPxFor, lineGeom } from "../src/lib/videoAnalysis/findCrossings/geometry";
import type {
  CrossingResult,
  CrossingTarget,
  FrameCrop,
  SectorLine,
} from "../src/lib/videoAnalysis/findCrossings/types";

const PROBE_DIR = "C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me";
const SF_KEY = "sf";

type ProbeData = {
  videoPath: string;
  lines: SectorLine[];
  anchor: { lapNumber: number; videoTimeSec: number };
  laps: Array<{ lapNumber: number; lapTimeSec: number }>;
  seedOffsets: Record<string, number>;
};

type ReferenceRow = { id: string; auto: number | null };

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", () => resolve({ stdout, stderr }));
  });
}

async function probeVideo(videoPath: string): Promise<{ width: number; height: number; durationSec: number }> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    videoPath,
  ]);
  const j = JSON.parse(stdout);
  return {
    width: j.streams[0].width,
    height: j.streams[0].height,
    durationSec: Number(j.format.duration),
  };
}

/**
 * Decode one window's ROI crop and feed it to the scanner frame by frame.
 *
 * Frame times come from `showinfo` on stderr rather than being derived from a nominal frame
 * rate — this footage is variable frame rate (nominal 59.94, actual average 31.5), so any
 * computed timeline would drift by seconds across a heat.
 */
function scanWindow(
  videoPath: string,
  scanner: WindowScanner,
  roiW: number,
  roiH: number,
  roiX: number,
  roiY: number,
  startSec: number,
  durationSec: number,
  lumaOnly: boolean
): Promise<number> {
  // Brightness-only is requested as a filter step with an rgb24 output, NOT as "-pix_fmt gray".
  // A one-channel output keeps the crop in YUV, where chroma subsampling forces an even height —
  // so an odd-height ROI silently comes back one row short and every frame after the first is
  // misaligned. It reads as enormous noise and is completely invisible in the output.
  const channels = 3;
  const frameBytes = roiW * roiH * channels;

  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-loglevel", "info",
        // -copyts keeps showinfo's timestamps on the original timeline. It also makes -t
        // absolute, which silently drops every frame — hence -to, not -t.
        "-copyts",
        "-ss", startSec.toFixed(6),
        "-i", videoPath,
        "-to", (startSec + durationSec).toFixed(6),
        // Without this, ffmpeg duplicates frames to fake a constant rate on this VFR file
        // and the 1:1 pairing with showinfo's timestamps falls apart.
        "-fps_mode", "passthrough",
        "-vf", `crop=${roiW}:${roiH}:${roiX}:${roiY}${lumaOnly ? ",format=gray" : ""},showinfo`,
        "-pix_fmt", "rgb24",
        "-f", "rawvideo",
        "-",
      ],
      { windowsHide: true }
    );

    const times: number[] = [];
    let stderrTail = "";
    const frame = Buffer.allocUnsafe(frameBytes);
    const view = new Uint8Array(frame.buffer, frame.byteOffset, frameBytes);
    let filled = 0;
    let consumed = 0;

    ff.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      // showinfo also prints frames past -to that the muxer then drops, so there can be a
      // few more timestamps than frames. They are at the END, so pairing by index holds.
      for (const m of text.matchAll(/pts_time:([-\d.]+)/g)) times.push(Number(m[1]));
    });

    ff.stdout.on("data", (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.length) {
        const take = Math.min(frameBytes - filled, chunk.length - offset);
        chunk.copy(frame, filled, offset, offset + take);
        filled += take;
        offset += take;
        if (filled < frameBytes) continue;
        filled = 0;
        const t = times[consumed];
        consumed++;
        if (t == null) continue;
        scanner.push({ width: roiW, height: roiH, channels, data: view }, t);
      }
    });

    ff.on("error", reject);
    ff.on("close", (code) => {
      if (code !== 0 && consumed === 0) {
        reject(new Error(`ffmpeg exited ${code}\n${stderrTail}`));
        return;
      }
      resolve(consumed);
    });
  });
}

/** Decode a short clip of one ROI, for measuring what the band does at rest. */
function decodeSample(
  videoPath: string,
  roiW: number,
  roiH: number,
  roiX: number,
  roiY: number,
  startSec: number,
  durationSec: number,
  gray: boolean
): Promise<FrameCrop[]> {
  // See scanWindow: gray must be a filter step with rgb24 output, never a one-channel output.
  const channels = 3;
  const frameBytes = roiW * roiH * channels;
  return new Promise((resolve) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-nostdin", "-loglevel", "error",
        "-ss", startSec.toFixed(6), "-i", videoPath,
        "-t", durationSec.toFixed(6), "-fps_mode", "passthrough",
        "-vf", `crop=${roiW}:${roiH}:${roiX}:${roiY}${gray ? ",format=gray" : ""}`,
        "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ],
      { windowsHide: true }
    );
    const out: FrameCrop[] = [];
    let cur = Buffer.allocUnsafe(frameBytes);
    let filled = 0;
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(frameBytes - filled, chunk.length - off);
        chunk.copy(cur, filled, off, off + take);
        filled += take;
        off += take;
        if (filled === frameBytes) {
          out.push({ width: roiW, height: roiH, channels, data: new Uint8Array(cur) });
          cur = Buffer.allocUnsafe(frameBytes);
          filled = 0;
        }
      }
    });
    ff.on("close", () => resolve(out));
  });
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  const probe: ProbeData = JSON.parse(readFileSync(path.join(PROBE_DIR, "probe-data.json"), "utf8"));
  const which = arg("lines", "all")!;
  const limit = Number(arg("limit", "0"));
  const outPath = arg("out");
  const qualityFloor = Number(arg("quality", "0"));
  // Which parameter set is on trial. Everything below reads THIS, so a variant is a fair test.
  // Defaults to the recipe the app runs: grading a change on the July recipe's wide zones read
  // as a 91→75 regression on 2026-09-02 that was no regression at all.
  const recipeName = arg("recipe", "far")!;
  const recipe = RECIPE_VARIANTS[recipeName];
  if (!recipe) throw new Error("unknown recipe " + recipeName + " — have: " + Object.keys(RECIPE_VARIANTS).join(", "));
  const minArea = Number(arg("minarea", String(recipe.minArea)));
  // The recipe takes the largest of the three colour channels, to catch a coloured car against
  // similar-brightness tarmac. On this footage that also amplifies chroma reconstruction noise on
  // painted kerbs by an order of magnitude, which is what floods the corner bands.
  const lumaOnly = process.argv.includes("--luma");
  // Threshold 14 was tuned with colour noise present. On luma alone the real signal is smaller
  // too, so the gate may now be too high — hence sweepable.
  const thresh = Number(arg("thresh", String(recipe.thresh)));
  // Judge each frame pair alone, the way the offline probe did — the before picture for tracking.
  const noTrack = process.argv.includes("--notrack");

  let reference: Map<string, number | null> | null = null;
  try {
    const rows: ReferenceRow[] = JSON.parse(
      readFileSync(path.join(PROBE_DIR, "loop-results-b22-t14.json"), "utf8")
    );
    reference = new Map(rows.map((r) => [r.id, r.auto]));
  } catch {
    reference = null;
  }

  const { width, height, durationSec } = await probeVideo(probe.videoPath);
  console.log(`video ${width}x${height}, ${durationSec.toFixed(2)}s — ${probe.videoPath}`);
  // What each line actually watches under this recipe — the number the far-hairpin argument turns
  // on. A zone several times longer than the line is a zone mostly looking at track nobody drew.
  console.log(`recipe ${recipeName}: ${JSON.stringify(recipe)}`);
  for (const l of probe.lines) {
    const g = lineGeom(l, width, height);
    const half = bandHalfPxFor(g, width, recipe);
    const cap = half * (recipe.endCapBands ?? 1);
    const zoneLen = g.norm + 2 * cap;
    console.log(
      `  ${l.lineKey.padEnd(3)} line ${g.norm.toFixed(0).padStart(4)}px` +
        ` · zone ${zoneLen.toFixed(0).padStart(4)} x ${(2 * half).toFixed(0).padStart(3)}px` +
        ` · zone length ${(zoneLen / g.norm).toFixed(1)}x the line`
    );
  }

  const lineByKey = new Map(probe.lines.map((l) => [l.lineKey, l]));
  let targets: CrossingTarget[] = [];
  if (which === "sf" || which === "all") {
    targets.push(...sfBoundaryTargets(SF_KEY, probe.anchor, probe.laps, durationSec));
  }
  if (which === "corners" || which === "all") {
    targets.push(
      ...cornerTargets(probe.lines, SF_KEY, probe.anchor, probe.laps, probe.seedOffsets, durationSec)
    );
  }
  if (limit > 0) targets = targets.slice(0, limit);

  // Calibrate each line before using it: measure what its band does with nothing crossing, and
  // let that decide colour-vs-brightness and the motion threshold. One short clip per line.
  const CAL_TIMES = [400, 470, 540, 610];
  const CAL_SEC = 1.5;
  const calibrations = new Map<string, LineCalibration>();
  if (!process.argv.includes("--nocal")) {
    console.log(`calibrating ${lineByKey.size} lines from ${CAL_TIMES.length} x ${CAL_SEC}s samples:`);
    for (const [key, line] of lineByKey) {
      const roi = roiFor(line, width, height);
      const roiW = roi.x1 - roi.x0;
      const roiH = roi.y1 - roi.y0;
      const bm = bandMask(line, roi, width, height, recipe);
      const spans = spansFromMask(bm, roiW, roiH);
      // Several clips spread through the session, keeping the quietest: on a busy heat any one
      // sample is likely to have a car in the band, and a car reads as noise.
      const colourDiffs = [];
      const lumaDiffs = [];
      const kernel = blurKernelForLine(line, width, height, recipe);
      for (const at of CAL_TIMES) {
        const [cf, lf] = await Promise.all([
          decodeSample(probe.videoPath, roiW, roiH, roi.x0, roi.y0, at, CAL_SEC, false),
          decodeSample(probe.videoPath, roiW, roiH, roi.x0, roi.y0, at, CAL_SEC, true),
        ]);
        const cd = bandFrameDiffs(cf, bm, spans, kernel);
        const ld = bandFrameDiffs(lf, bm, spans, kernel);
        const n = Math.min(cd.length, ld.length);
        colourDiffs.push(...cd.slice(0, n));
        lumaDiffs.push(...ld.slice(0, n));
      }
      const cal = calibrateFromDiffs(colourDiffs, lumaDiffs, kernel);
      calibrations.set(key, cal);
      console.log(
        `  ${key.padEnd(3)} colour ${String(cal.colour?.quiet ?? "-").padStart(3)}/${String(cal.colour?.typical ?? "-").padStart(3)} · ` +
          `brightness ${String(cal.luma?.quiet ?? "-").padStart(3)}/${String(cal.luma?.typical ?? "-").padStart(3)} · ` +
          `penalty ${cal.colourPenalty?.toFixed(1) ?? "-"} → ${cal.mode} @ ${cal.thresh}`
      );
    }
    console.log("");
  }

  console.log(`${targets.length} targets · window ±${WINDOW_SEC}s\n`);

  const results: Array<TrackedResult & { events?: Array<{ t: number; quality: number }> }> = [];
  const startedAt = Date.now();

  for (const [i, target] of targets.entries()) {
    const line = lineByKey.get(target.lineKey);
    if (!line) continue;
    const roi = roiFor(line, width, height);
    const roiW = roi.x1 - roi.x0;
    const roiH = roi.y1 - roi.y0;

    const cal = calibrations.get(target.lineKey);
    const useLuma = cal ? cal.mode === "luma" : lumaOnly;
    const useThresh = cal ? cal.thresh : thresh;

    const scanner = new WindowScanner(
      line,
      roi,
      width,
      height,
      { ...recipe, minArea, thresh: useThresh },
      3
    );
    const frames = await scanWindow(
      probe.videoPath,
      scanner,
      roiW,
      roiH,
      roi.x0,
      roi.y0,
      target.centerSec - WINDOW_SEC,
      WINDOW_SEC * 2,
      useLuma
    );

    const result: TrackedResult = noTrack
      ? {
          ...resultFromSamples(target, scanner.samples, qualityFloor),
          source: null,
          rawEventCount: 0,
          trackCrossingCount: 0,
          candidates: [],
          colourRejected: 0,
          candidateColours: [],
        }
      : resultFromWindow(target, scanner.samples, scanner.frames, scanner.trackerConfig, {
          qualityFloor,
          bounds: scanner.bounds,
        });
    // Keep every candidate event, not just the chosen one: re-picking offline is seconds,
    // re-decoding 115 windows of 4K is minutes.
    results.push({ ...result, events: eventsFromSamples(scanner.samples) });

    const ref = reference?.get(target.id);
    const refStr =
      reference == null
        ? ""
        : ref == null
          ? result.detectedSec == null
            ? "  ref MISS ✓"
            : "  ref MISS ✗ (we found one)"
          : result.detectedSec == null
            ? "  ref HIT ✗ (we missed)"
            : `  vs ref ${((result.detectedSec - ref) * 1000).toFixed(1)}ms`;

    const truthStr =
      target.truthSec != null && result.detectedSec != null
        ? `  err ${((result.detectedSec - target.truthSec) * 1000).toFixed(1)}ms`
        : "";

    console.log(
      `[${String(i + 1).padStart(3)}/${targets.length}] ${target.id.padEnd(9)} ` +
        `${frames} frames · ${scanner.samples.length} samples · ` +
        (noTrack
          ? `${result.eventCount} events · `
          : `${result.rawEventCount}->${result.eventCount} ev · ${result.trackCrossingCount} trk · ` +
            `${(result.source ?? "-").padEnd(11)} `) +
        (result.detectedSec == null ? "MISS" : result.detectedSec.toFixed(4)) +
        truthStr +
        refStr
    );
  }

  console.log(`\nscanned in ${((Date.now() - startedAt) / 1000).toFixed(0)}s\n`);

  if (!noTrack) {
    const by = (s: string) => results.filter((r) => r.source === s).length;
    const trimmed = results.filter((r) => r.source === "confirmed" && r.rawEventCount > 1).length;
    const offLine = results.reduce((n, r) => n + (r.offLineRejected ?? 0), 0);
    console.log(`off-line rejected: ${offLine} candidates changed sides away from the drawn line\n`);
    console.log(
      `tracking: ${by("confirmed")} confirmed · ${by("rescued")} rescued · ` +
        `${by("unconfirmed")} unconfirmed · ${results.filter((r) => r.source === null).length} miss\n` +
        `  rival candidates discarded on ${trimmed} windows\n`
    );
  }

  // Second pass: re-read each lap in track order, chaining each corner off the one before it.
  if (!process.argv.includes("--nochain")) {
    const before = results.map((r) => r.detectedSec);
    const refined = refineByChaining(results, SF_KEY);
    let moved = 0;
    for (const [i, r] of refined.entries()) {
      if (r.movedBy != null && Math.abs(r.movedBy) > 0.0005) {
        moved++;
        console.log(
          `  chained ${r.id.padEnd(9)} ${before[i]!.toFixed(3)} → ${r.detectedSec!.toFixed(3)} ` +
            `(${(r.movedBy * 1000).toFixed(0)}ms)`
        );
      }
      results[i] = r;
    }
    console.log(`lap chaining: ${moved} crossings moved\n`);
  }

  // --- Check 1: lap-time self-check on start/finish -------------------------------------
  const sf = results.filter((r) => r.lineKey === SF_KEY && r.detectedSec != null);
  if (sf.length > 1) {
    const lapTimes = new Map(probe.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
    const errs: number[] = [];
    for (let i = 1; i < sf.length; i++) {
      const lap = sf[i - 1].lapNumber;
      const expected = lapTimes.get(lap);
      if (expected == null) continue;
      const measured = sf[i].detectedSec! - sf[i - 1].detectedSec!;
      errs.push(Math.abs(measured - expected) * 1000);
    }
    console.log(
      `lap-time self-check: ${errs.length} laps · median ${median(errs).toFixed(1)}ms · ` +
        `max ${Math.max(...errs).toFixed(1)}ms · within 50ms ${errs.filter((e) => e <= 50).length}/${errs.length}`
    );
  }

  // --- Check 2: agreement with the offline probe ----------------------------------------
  if (reference) {
    const both: number[] = [];
    let missMatch = 0;
    let missMismatch = 0;
    for (const r of results) {
      const ref = reference.get(r.id);
      if (ref === undefined) continue;
      if (ref == null || r.detectedSec == null) {
        if (ref == null && r.detectedSec == null) missMatch++;
        else missMismatch++;
        continue;
      }
      both.push(Math.abs(r.detectedSec - ref) * 1000);
    }
    console.log(
      `reference agreement: ${both.length} shared hits · median ${median(both).toFixed(1)}ms · ` +
        `max ${Math.max(...both).toFixed(1)}ms · within 1 frame ${both.filter((e) => e <= 32).length}/${both.length}`
    );
    console.log(`miss agreement: ${missMatch} matched, ${missMismatch} disagreed`);
  }

  // --- Check 3: raw detection rate ------------------------------------------------------
  const corners = results.filter((r) => r.lineKey !== SF_KEY);
  console.log(
    `detection rate: sf ${results.filter((r) => r.lineKey === SF_KEY && r.detectedSec != null).length}/` +
      `${results.filter((r) => r.lineKey === SF_KEY).length} · ` +
      `corners ${corners.filter((r) => r.detectedSec != null).length}/${corners.length}`
  );

  // --- Check 3b: is each detection plausible as a sector time? ----------------------------
  // The strongest check that needs no reference data at all. A driver's time from the start line
  // to a given corner barely moves lap to lap — a second or two of spread across a whole race,
  // set by traffic and mistakes. So a detection that sits far from that line's own median is
  // almost certainly something else that moved. This is the check that says whether the extra
  // crossings found here are cars or rubbish.
  {
    const sfAt = new Map(
      results
        .filter((r) => r.lineKey === SF_KEY && r.detectedSec != null)
        .map((r) => [r.lapNumber, r.detectedSec!])
    );
    const byLine = new Map<string, Array<{ lap: number; offset: number }>>();
    for (const r of results) {
      if (r.lineKey === SF_KEY || r.detectedSec == null) continue;
      const start = sfAt.get(r.lapNumber);
      if (start == null) continue;
      const list = byLine.get(r.lineKey) ?? [];
      list.push({ lap: r.lapNumber, offset: r.detectedSec - start });
      byLine.set(r.lineKey, list);
    }
    console.log("sector-time plausibility (time from the start line to this corner, per lap):");
    let odd = 0;
    let total = 0;
    for (const [key, list] of [...byLine].sort()) {
      const offs = list.map((l) => l.offset);
      const mid = median(offs);
      // Median absolute deviation: a spread measure that a couple of wild values cannot inflate,
      // unlike standard deviation — which is the whole point when hunting wild values.
      const mad = median(offs.map((o) => Math.abs(o - mid)));
      const tol = Math.max(0.35, mad * 4);
      const bad = list.filter((l) => Math.abs(l.offset - mid) > tol);
      odd += bad.length;
      total += list.length;
      console.log(
        `  ${key.padEnd(3)} ${String(list.length).padStart(2)} laps · median ${mid.toFixed(2)}s · ` +
          `spread ±${mad.toFixed(3)}s · ${bad.length} implausible` +
          (bad.length
            ? ` (${bad.map((b) => `L${b.lap} ${b.offset.toFixed(2)}s`).join(", ")})`
            : "")
      );
    }
    console.log(`  ${total - odd}/${total} corner detections plausible`);

    // Order is a harder constraint than spread, and free. The corners sit in a fixed sequence
    // round the track, so within one lap their times must increase in that order. A detection
    // that lands before the corner in front of it is wrong no matter how confident it looks —
    // and the spread test above can miss it, because a busy line's own spread is wide enough
    // to hide a three-second error.
    const order = [...byLine]
      .map(([key, list]) => ({ key, mid: median(list.map((l) => l.offset)) }))
      .sort((a, b) => a.mid - b.mid)
      .map((o) => o.key);
    const laps = [...new Set(results.map((r) => r.lapNumber))].sort((a, b) => a - b);
    const outOfOrder: string[] = [];
    for (const lap of laps) {
      let prevKey: string | null = null;
      let prevOff = -Infinity;
      for (const key of order) {
        const hit = byLine.get(key)?.find((l) => l.lap === lap);
        if (!hit) continue;
        if (hit.offset < prevOff) outOfOrder.push(`L${lap} ${key} before ${prevKey}`);
        prevKey = key;
        prevOff = hit.offset;
      }
    }
    console.log(
      `  track order ${order.join(" → ")} · ` +
        (outOfOrder.length ? `${outOfOrder.length} out of order: ${outOfOrder.join(", ")}` : "all laps in order") +
        "\n"
    );
  }

  // --- Check 4: against Jordan's own hand marks --------------------------------------------
  // The strongest check for corners, because unlike the reference it does not assume the
  // 2026-07 run was right — it is what a human said they saw.
  try {
    const { marks } = JSON.parse(
      readFileSync(path.join(PROBE_DIR, "hand-marks.json"), "utf8")
    ) as { marks: Array<{ lineKey: string; videoTimeSec: number }> };

    const errs: number[] = [];
    let missed = 0;
    const rows: string[] = [];
    for (const mark of marks) {
      // Match by time, not lap number: the detector bins by SF interval, the marks do not.
      let target: (typeof results)[number] | null = null;
      for (const r of results) {
        if (r.lineKey !== mark.lineKey) continue;
        if (!target || Math.abs(r.centerSec - mark.videoTimeSec) < Math.abs(target.centerSec - mark.videoTimeSec)) {
          target = r;
        }
      }
      if (!target) continue;
      if (target.detectedSec == null) {
        missed++;
        rows.push(`  ${mark.lineKey} @ ${mark.videoTimeSec.toFixed(3)}  MISS  (${target.id})`);
        continue;
      }
      const errMs = (target.detectedSec - mark.videoTimeSec) * 1000;
      errs.push(Math.abs(errMs));
      rows.push(
        `  ${mark.lineKey} @ ${mark.videoTimeSec.toFixed(3)}  detected ${target.detectedSec.toFixed(3)}  ` +
          `${errMs >= 0 ? "+" : ""}${errMs.toFixed(0)}ms  q${target.quality ?? "-"}  (${target.id}, ${target.eventCount} events)`
      );
    }
    if (errs.length || missed) {
      console.log(
        `\nhand marks: ${errs.length}/${errs.length + missed} found · median ${median(errs).toFixed(0)}ms · ` +
          `within 100ms ${errs.filter((e) => e <= 100).length}/${errs.length}`
      );
      for (const r of rows) console.log(r);
    }
  } catch {
    // no hand marks on disk — the other three checks still stand
  }

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(results, null, 1));
    console.log(`\nwrote ${outPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
