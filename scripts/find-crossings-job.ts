/**
 * Re-run a real analysis job headlessly, and print what each sector actually came out at.
 *
 * The browser scan is the only way a driver runs this, which makes a regression invisible until
 * somebody clicks through a whole session. This takes a job id, reads its lines, laps and sync
 * from the database, decodes the same windows with ffmpeg, and runs the same detector, review and
 * clock code the app runs — then prints the sector times per lap and how much each one varies.
 *
 * The number to look at is the spread of each sector across the session. A driver does not vary
 * by half a second in one corner and by five hundredths in the next; where they appear to, it is
 * the measurement, not the driving.
 *
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/find-crossings-job.ts <jobId> [--video PATH]
 *     [--recipe NAME] [--laps 2,3,5] [--no-clock] [--json OUT]
 *
 * `--no-clock` reverts to the old behaviour — lap starts walked from the transponder with no
 * drift correction — so the two can be compared on identical footage.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

import {
  WindowScanner,
  eventsFromSamples,
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
import type { FieldDriver } from "../src/lib/videoAnalysis/findCrossings/field";
import {
  buildTargets,
  realLaps,
  reviewResults,
  SF_LINE_KEY,
  type SessionLine,
  type SessionTarget,
} from "../src/lib/videoAnalysis/findCrossings/fromSession";
import { ACTIVE_RECIPE, RECIPE_VARIANTS, type DetectorParams } from "../src/lib/videoAnalysis/findCrossings/types";

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("error", reject);
    p.on("close", () => resolve(out));
  });
}

async function videoInfo(path: string) {
  const stdout = await run("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-show_entries", "format=duration",
    "-of", "json", path,
  ]);
  const j = JSON.parse(stdout);
  return { width: j.streams[0].width as number, height: j.streams[0].height as number, durationSec: Number(j.format.duration) };
}

/** Decode one window's crop and feed it to the scanner, frame by frame, on the file's own clock. */
function scanWindow(
  videoPath: string,
  scanner: WindowScanner,
  roi: { x0: number; y0: number; x1: number; y1: number },
  startSec: number,
  durationSec: number,
  lumaOnly: boolean
): Promise<number> {
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const frameBytes = w * h * 3;
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-nostdin", "-loglevel", "info", "-copyts",
      "-ss", startSec.toFixed(6), "-i", videoPath,
      "-to", (startSec + durationSec).toFixed(6), "-fps_mode", "passthrough",
      "-vf", `crop=${w}:${h}:${roi.x0}:${roi.y0}${lumaOnly ? ",format=gray" : ""},showinfo`,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ], { windowsHide: true });

    const times: number[] = [];
    const frame = Buffer.allocUnsafe(frameBytes);
    const view = new Uint8Array(frame.buffer, frame.byteOffset, frameBytes);
    let filled = 0;
    let consumed = 0;
    ff.stderr.on("data", (d: Buffer) => {
      for (const m of d.toString().matchAll(/pts_time:([-\d.]+)/g)) times.push(Number(m[1]));
    });
    ff.stdout.on("data", (chunk: Buffer) => {
      let off = 0;
      while (off < chunk.length) {
        const take = Math.min(frameBytes - filled, chunk.length - off);
        chunk.copy(frame, filled, off, off + take);
        filled += take;
        off += take;
        if (filled < frameBytes) continue;
        filled = 0;
        const t = times[consumed];
        consumed++;
        if (t == null) continue;
        scanner.push({ width: w, height: h, channels: 3, data: view }, t);
      }
    });
    ff.on("error", reject);
    ff.on("close", () => resolve(consumed));
  });
}

function decodeSample(
  videoPath: string,
  roi: { x0: number; y0: number; x1: number; y1: number },
  startSec: number,
  durationSec: number,
  gray: boolean
) {
  const w = roi.x1 - roi.x0;
  const h = roi.y1 - roi.y0;
  const frameBytes = w * h * 3;
  return new Promise<Array<{ width: number; height: number; channels: number; data: Uint8Array }>>((resolve) => {
    const ff = spawn("ffmpeg", [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-ss", startSec.toFixed(6), "-i", videoPath, "-t", durationSec.toFixed(6),
      "-fps_mode", "passthrough",
      "-vf", `crop=${w}:${h}:${roi.x0}:${roi.y0}${gray ? ",format=gray" : ""}`,
      "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
    ], { windowsHide: true });
    const out: Array<{ width: number; height: number; channels: number; data: Uint8Array }> = [];
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
          out.push({ width: w, height: h, channels: 3, data: new Uint8Array(cur) });
          cur = Buffer.allocUnsafe(frameBytes);
          filled = 0;
        }
      }
    });
    ff.on("close", () => resolve(out));
  });
}

type TruthFile = {
  label?: string;
  video?: string;
  marks: Array<{ driverRole?: string; lapNumber: number; lineKey: string; videoTimeSec: number }>;
};

/**
 * How far the detector landed from where the driver said the car crossed, per crossing.
 * Signed, in milliseconds: positive = the detector was late.
 */
function grade(
  truth: TruthFile,
  at: Map<number, Map<string, number>>,
  heldIds: Set<string>,
  labelOf: Map<string, string>
): void {
  const errs: number[] = [];
  const perLine = new Map<string, number[]>();
  console.log("\nAGAINST YOUR HAND MARKS — signed milliseconds, + means the detector was late");
  console.log("lap  line        yours      found     error");
  for (const m of [...truth.marks].sort((a, b) => a.lapNumber - b.lapNumber || a.lineKey.localeCompare(b.lineKey))) {
    const found = at.get(m.lapNumber)?.get(m.lineKey);
    const label = labelOf.get(m.lineKey) ?? m.lineKey;
    if (found == null) {
      console.log(`${String(m.lapNumber).padStart(3)}  ${label.padEnd(6)}${m.videoTimeSec.toFixed(3).padStart(9)}          -   MISSED`);
      continue;
    }
    const ms = (found - m.videoTimeSec) * 1000;
    errs.push(ms);
    perLine.set(m.lineKey, [...(perLine.get(m.lineKey) ?? []), ms]);
    const held = heldIds.has(`me:${m.lapNumber}:${m.lineKey}`) ? "  held" : "";
    console.log(
      `${String(m.lapNumber).padStart(3)}  ${label.padEnd(6)}${m.videoTimeSec.toFixed(3).padStart(9)}` +
        `${found.toFixed(3).padStart(11)}${(ms >= 0 ? "+" : "") + ms.toFixed(0).padStart(8)}ms${held}`
    );
  }
  if (!errs.length) return;
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  console.log("\n  per line:");
  for (const [key, xs] of perLine) {
    const a = xs.map(Math.abs).sort((p, q) => p - q);
    console.log(
      `    ${(labelOf.get(key) ?? key).padEnd(6)} n=${xs.length}  median error ${median(a).toFixed(0)}ms  ` +
        `worst ${a[a.length - 1]!.toFixed(0)}ms  bias ${median(xs) >= 0 ? "+" : ""}${median(xs).toFixed(0)}ms`
    );
  }
  const within = (n: number) => abs.filter((x) => x <= n).length;
  console.log(
    `\n  ${errs.length}/${truth.marks.length} found · median ${median(abs).toFixed(0)}ms · ` +
      `worst ${abs[abs.length - 1]!.toFixed(0)}ms · within 33ms (one frame): ${within(33)} · within 100ms: ${within(100)}`
  );
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

async function main() {
  const jobId = process.argv[2];
  if (!jobId || jobId.startsWith("--")) throw new Error("usage: find-crossings-job.ts <jobId>");
  const recipeName = arg("recipe");
  const recipe: DetectorParams = recipeName ? RECIPE_VARIANTS[recipeName]! : ACTIVE_RECIPE;
  if (!recipe) throw new Error(`unknown recipe ${recipeName}`);
  const useClock = !process.argv.includes("--no-clock");

  /**
   * Ground truth: crossings a driver placed by hand, frozen out of the job by `crossings-truth.mts`.
   * The laps it covers are scanned BLIND — their marks are withheld from the search windows too,
   * or the detector is being told the answer it is about to be graded on.
   */
  const truthPath = arg("truth");
  const truth = truthPath ? (JSON.parse(readFileSync(truthPath, "utf8")) as TruthFile) : null;
  const truthLaps = new Set<number>(truth?.marks.map((m) => m.lapNumber) ?? []);

  const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
  const manual = (job.manualJson ?? {}) as any;
  const profile = job.profileId
    ? await prisma.trackCameraProfile.findUnique({
        where: { id: job.profileId },
        select: { name: true, sectorLines: true },
      })
    : null;
  if (!profile) throw new Error("job has no camera profile");

  const lines: SessionLine[] = profile.sectorLines
    .filter((l) => l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null)
    .map((l) => ({
      lineKey: l.lineKey, label: l.label, sortOrder: l.sortOrder,
      x1: l.x1!, y1: l.y1!, x2: l.x2!, y2: l.y2!,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const ts = (manual.timingSessions ?? []).find((s: any) => s.isOnVideo) ?? (manual.timingSessions ?? [])[0];
  // Whose laps to scan. A rival added from their own practice link sits in their own timing
  // session, with their own anchor; the field (every driver on the video) is built regardless.
  const role = (arg("role") ?? "me") as "me" | "competitor";
  const ownSession =
    (manual.timingSessions ?? []).find((s: any) => (s.drivers ?? []).some((d: any) => d.role === role)) ?? ts;
  const driver = (ownSession.drivers ?? []).find((d: any) => d.role === role) ?? ownSession.drivers[0];
  // This driver's own anchor: a rival synced from their own link carries their own.
  const anchor = ownSession.sync?.anchorByRole?.[role] ?? ownSession.sync?.anchor;
  const allLaps = [...driver.laps].sort((a: any, b: any) => a.lapNumber - b.lapNumber);

  // The walk: the transponder's lap starts, exactly as the app builds them today.
  const walk = new Map<number, number>();
  const i0 = allLaps.findIndex((l: any) => l.lapNumber === anchor.lapNumber);
  let t = anchor.videoTimeSec - (anchor.anchorKind === "sf_finish" ? allLaps[i0].lapTimeSec : 0);
  walk.set(allLaps[i0].lapNumber, t);
  for (let i = i0 + 1; i < allLaps.length; i++) { t += allLaps[i - 1].lapTimeSec; walk.set(allLaps[i].lapNumber, t); }
  t = walk.get(allLaps[i0].lapNumber)!;
  for (let i = i0 - 1; i >= 0; i--) { t -= allLaps[i].lapTimeSec; walk.set(allLaps[i].lapNumber, t); }

  const videoPath = arg("video") ?? (manual.localVideoName as string);
  const { width, height, durationSec } = await videoInfo(videoPath);
  console.log(`job ${jobId} · ${profile.name} · ${videoPath} ${width}x${height} ${durationSec.toFixed(1)}s`);
  console.log(`recipe ${recipeName ?? "ACTIVE"} ${JSON.stringify(recipe)} · lap clock ${useClock ? "measured" : "walked (old)"}\n`);

  // Everyone on the video with their lap starts, exactly as the app hands them to the review's
  // field matching: each driver walked from their own anchor. Without this the harness never
  // ran the matching at all, and a browser scan's "claimed by" rows had no headless twin.
  const field: FieldDriver[] = [];
  for (const session of manual.timingSessions ?? []) {
    if (!session.isOnVideo) continue;
    for (const d of session.drivers ?? []) {
      const a = session.sync?.anchorByRole?.[d.role] ?? session.sync?.anchor;
      if (!a) continue;
      const sorted = [...d.laps].sort((x: any, y: any) => x.lapNumber - y.lapNumber);
      const k0 = sorted.findIndex((l: any) => l.lapNumber === a.lapNumber);
      if (k0 < 0) continue;
      const starts = new Map<number, number>();
      let w = a.videoTimeSec - (a.anchorKind === "sf_finish" ? sorted[k0].lapTimeSec : 0);
      starts.set(sorted[k0].lapNumber, w);
      for (let i = k0 + 1; i < sorted.length; i++) { w += sorted[i - 1].lapTimeSec; starts.set(sorted[i].lapNumber, w); }
      w = starts.get(sorted[k0].lapNumber)!;
      for (let i = k0 - 1; i >= 0; i--) { w -= sorted[i].lapTimeSec; starts.set(sorted[i].lapNumber, w); }
      const real = new Set(realLaps(sorted).map((l: any) => l.lapNumber));
      const lapStarts = [...starts].filter(([n]) => real.has(n)).map(([lapNumber, startSec]) => ({ lapNumber, startSec }));
      const r = d.role === "other" ? undefined : d.role;
      if (lapStarts.length) field.push({ key: r ?? d.key, name: d.driverName, role: r, lapStarts });
    }
  }
  const useField = !process.argv.includes("--no-field");

  const only = arg("laps");
  const lapFilter = only ? new Set(only.split(",").map(Number)) : null;
  const laps = allLaps
    .filter((l: any) => walk.get(l.lapNumber) != null && (!lapFilter || lapFilter.has(l.lapNumber)))
    .map((l: any) => ({ role, lapNumber: l.lapNumber, lapTimeSec: l.lapTimeSec }));

  // Offsets to search around: from this job's own accepted marks, as the app does.
  const marks = (manual.marks ?? [])
    .filter((m: any) => (m.driverRole ?? "me") === role)
    .filter((m: any) => !truthLaps.has(m.lapNumber))
    .map((m: any) => ({ driverRole: role, lapNumber: m.lapNumber, lineKey: m.lineKey, videoTimeSec: m.videoTimeSec }));
  if (truth) {
    console.log(
      `grading against ${truth.marks.length} hand marks on laps ${[...truthLaps].sort((a, b) => a - b).join(", ")} ` +
        `(scanned blind: their own marks are withheld)\n`
    );
  }

  // `--seeds s1=2.4,s2=4.1,…` searches around explicit offsets into the lap instead of ones
  // learnt from this job's marks — the only honest option when the marks are stale (a re-sync
  // moved the anchor a lap or two, and every mark's lap number with it) or absent for this
  // driver. `--no-marks` withholds the marks from the search entirely.
  const seedsArg = arg("seeds");
  const seeds = seedsArg
    ? Object.fromEntries(seedsArg.split(",").map((kv) => { const [k, v] = kv.split("="); return [k!, Number(v)]; }))
    : undefined;
  const searchMarks = process.argv.includes("--no-marks") ? [] : marks;
  // `--dir s5=+1,s2=-1` declares which way through a line is the corner, as a tap at the picker
  // would. Without it the review goes by the majority of its own picks — see `direction.ts`.
  const dirArg = arg("dir");
  const lineDirections: Partial<Record<string, 1 | -1>> | undefined = dirArg
    ? Object.fromEntries(
        dirArg.split(",").map((kv) => {
          const [k, v] = kv.split("=");
          return [k!, v?.trim().startsWith("-") ? -1 : 1];
        })
      )
    : undefined;
  const built = buildTargets({
    lines, laps, marks: searchMarks,
    lapStart: (_role, lapNumber) => walk.get(lapNumber) ?? null,
    durationSec,
    skipMarked: false,
    ...(seeds ? { seeds } : {}),
  });
  console.log(`${built.targets.length} windows (${built.lapStarts.length} lap starts)\n`);
  if (process.argv.includes("--debug-targets")) {
    console.log(`  role ${role} · session ${ownSession.sessionId} · driver ${driver.key} · anchor ${JSON.stringify(anchor)}`);
    console.log(`  laps ${allLaps.slice(0, 4).map((l: any) => `${l.lapNumber}:${l.lapTimeSec}`).join(" ")} … · walk ${[...walk.entries()].slice(0, 4).map(([n, t]) => `${n}@${t.toFixed(2)}`).join(" ")}`);
    console.log(`  marks used: ${marks.length} · s1 marks ${marks.filter((m: any) => m.lineKey === "s1").map((m: any) => `L${m.lapNumber}@${m.videoTimeSec.toFixed(2)}`).join(" ")}`);
    for (const t of built.targets) {
      const start = walk.get(t.lapNumber) ?? NaN;
      console.log(
        `  ${t.lineKey.padEnd(3)} L${String(t.lapNumber).padStart(2)}  centre ${t.centerSec.toFixed(3)}  ` +
          `(${(t.centerSec - start).toFixed(3)}s into the lap)  window ${t.searchFrom?.toFixed(2) ?? "-"}–${t.searchTo?.toFixed(2) ?? "-"}`
      );
    }
    await prisma.$disconnect();
    return;
  }

  // Per-line calibration, exactly as the browser scan does it.
  const calib = new Map<string, LineCalibration>();
  const calOverride: Record<string, { mode: "colour" | "luma"; thresh: number }> = {};
  for (const kv of (arg("cal") ?? "").split(",").filter(Boolean)) {
    const [k, v] = kv.split("=");
    const [mode, thresh] = (v ?? "").split("@");
    if (k && (mode === "colour" || mode === "luma") && Number(thresh) > 0) calOverride[k] = { mode, thresh: Number(thresh) };
  }
  for (const line of lines) {
    const roi = roiFor(line, width, height);
    const bm = bandMask(line, roi, width, height, recipe);
    const spans = spansFromMask(bm, roi.x1 - roi.x0, roi.y1 - roi.y0);
    const at = Math.min(durationSec * 0.5, Math.max(5, durationSec * 0.25));
    const [cf, lf] = await Promise.all([
      decodeSample(videoPath, roi, at, 1.5, false),
      decodeSample(videoPath, roi, at, 1.5, true),
    ]);
    const kernel = blurKernelForLine(line, width, height, recipe);
    let cal = calibrateFromDiffs(
      bandFrameDiffs(cf, bm, spans, kernel),
      bandFrameDiffs(lf, bm, spans, kernel),
      kernel
    );
    // `--cal s2=colour@12,s5=luma@7` pins a line's gate to what another run measured — the way to
    // ask whether a browser scan's misses are its calibration or its pixels.
    const pinned = calOverride[line.lineKey];
    if (pinned) cal = { ...cal, mode: pinned.mode, thresh: pinned.thresh, reason: `pinned by --cal` };
    calib.set(line.lineKey, cal);
    console.log(`  cal ${line.lineKey.padEnd(3)} → ${cal.mode} @ ${cal.thresh} · blur ${kernel}${pinned ? " (pinned)" : ""}`);
  }
  console.log("");

  const byKey = new Map(lines.map((l) => [l.lineKey, l]));
  const results: Array<TrackedResult & { role: "me" | "competitor" }> = [];
  const started = Date.now();
  for (const [i, target] of built.targets.entries()) {
    const line = byKey.get(target.lineKey);
    if (!line) continue;
    const roi = roiFor(line, width, height);
    const cal = calib.get(target.lineKey);
    const params = { ...recipe, thresh: cal?.thresh ?? recipe.thresh };
    const scanner = new WindowScanner(line, roi, width, height, params, 3);
    const from = target.searchFrom ?? target.centerSec - 2;
    const to = target.searchTo ?? target.centerSec + 2;
    await scanWindow(videoPath, scanner, roi, from, to - from, cal?.mode === "luma");
    const r = resultFromWindow(target, scanner.samples, scanner.frames, scanner.trackerConfig, {
      bounds: scanner.bounds,
    });
    results.push({ ...r, role });
    if (process.argv.includes("--dump-candidates")) {
      // What the window saw before anything chose: every frame-pair flip, every tracked crossing,
      // and the pool that survived. This is how "the pool held one car when two went through" is
      // seen rather than argued.
      const flips = eventsFromSamples(scanner.samples);
      const fmt = (e: { t: number; dir?: number; quality?: number }) =>
        `${e.t.toFixed(2)}${e.dir === -1 ? "-" : e.dir === 1 ? "+" : ""}q${e.quality ?? "?"}`;
      console.log(
        `  ${target.lineKey.padEnd(3)} L${String(target.lapNumber).padStart(2)} ${from.toFixed(2)}–${to.toFixed(2)}` +
          ` picked ${r.detectedSec?.toFixed(2) ?? "-"} (${r.source ?? "none"})` +
          ` flips[${flips.length}]: ${flips.map(fmt).join(" ")}` +
          ` tracks[${r.trackCrossingCount}] offLine ${r.offLineRejected ?? 0}` +
          ` pool[${r.candidates.length}]: ${r.candidates.map(fmt).join(" ")}`
      );
    }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${built.targets.length} windows…`);
  }
  console.log(`scanned in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);

  const review = reviewResults({
    results,
    targets: built.targets as SessionTarget[],
    marks: [],
    lineDirections,
    ...(useField && field.length ? { field } : {}),
    lapStarts: useClock
      ? built.lapStarts
      : built.lapStarts.map((l) => ({ ...l })),
    laps,
  });
  for (const d of review.directions) {
    console.log(
      `  direction ${d.lineKey.padEnd(3)} ${d.dir > 0 ? "+" : "-"} (${d.from})` +
        `${d.turned ? ` · turned ${d.turned}` : ""}${d.emptied ? ` · emptied ${d.emptied}` : ""}`
    );
  }
  if (review.directions.length) console.log("");

  const startOf = new Map<number, number>();
  for (const l of review.measuredLapStarts) {
    startOf.set(l.lapNumber, useClock ? l.videoTimeSec : walk.get(l.lapNumber)!);
  }

  const at = new Map<number, Map<string, number>>();
  for (const r of [...review.found, ...review.suspect]) {
    const m = at.get(r.lapNumber) ?? new Map<string, number>();
    m.set(r.lineKey, r.videoTimeSec);
    at.set(r.lapNumber, m);
  }

  const corners = lines.filter((l) => l.lineKey !== SF_LINE_KEY);
  const heldByLap = new Map<number, number>();
  for (const r of review.suspect) heldByLap.set(r.lapNumber, (heldByLap.get(r.lapNumber) ?? 0) + 1);

  console.log("SECTOR TIMES (seconds), lap start → S1 → S2 …, and the run home to the line");
  console.log(
    "lap  lapTime " + corners.map((l) => l.label.padStart(8)).join("") + "    →finish  held"
  );
  const perSector = new Map<string, Array<{ lap: number; d: number }>>();
  const homeRuns: Array<{ lap: number; d: number }> = [];
  for (const lap of laps) {
    const start = startOf.get(lap.lapNumber);
    const found = at.get(lap.lapNumber);
    if (start == null || !found) continue;
    let prev = start;
    const cells: string[] = [];
    for (const line of corners) {
      const tt = found.get(line.lineKey);
      if (tt == null) { cells.push("       -"); continue; }
      const d = tt - prev;
      (perSector.get(line.lineKey) ?? perSector.set(line.lineKey, []).get(line.lineKey)!).push({ lap: lap.lapNumber, d });
      cells.push(d.toFixed(3).padStart(8));
      prev = tt;
    }
    const end = startOf.get(lap.lapNumber + 1) ?? start + lap.lapTimeSec;
    const home = end - prev;
    if (prev !== start) homeRuns.push({ lap: lap.lapNumber, d: home });
    console.log(
      String(lap.lapNumber).padStart(3) + "  " + lap.lapTimeSec.toFixed(3).padStart(7) +
      cells.join("") + "  " + home.toFixed(3).padStart(8) + "  " + (heldByLap.get(lap.lapNumber) ?? 0)
    );
  }

  console.log("\nHOW MUCH EACH SECTOR VARIES — the number that says whether it is measured or invented");
  const summary: Array<{ line: string; n: number; median: number; spread: number }> = [];
  for (const line of corners) {
    const xs = (perSector.get(line.lineKey) ?? []).map((r) => r.d).sort((a, b) => a - b);
    if (!xs.length) { console.log(`  ${line.label.padEnd(4)} no laps`); continue; }
    const med = median(xs);
    const spread = xs[xs.length - 1]! - xs[0]!;
    summary.push({ line: line.label, n: xs.length, median: med, spread });
    console.log(
      `  ${line.label.padEnd(4)} n=${String(xs.length).padStart(2)}  median ${med.toFixed(3)}s  ` +
        `min ${xs[0]!.toFixed(3)}  max ${xs[xs.length - 1]!.toFixed(3)}  spread ${spread.toFixed(3)}s`
    );
  }
  if (homeRuns.length) {
    const xs = homeRuns.map((r) => r.d).sort((a, b) => a - b);
    console.log(`  home n=${xs.length}  median ${median(xs).toFixed(3)}s  spread ${(xs[xs.length - 1]! - xs[0]!).toFixed(3)}s`);
  }

  console.log(
    `\nheld back: ${review.suspect.length} · missing: ${review.missing.length} · written: ${review.found.length}`
  );
  // The shift the sector times actually saw, NOT `driftSec`: where start/finish was detected the
  // detected crossing wins outright and the clock model's drift never gets applied. Printing the
  // drift there reads as a correction that was never made.
  const shifts = review.measuredLapStarts.map((l) => ({
    ...l,
    shiftSec: l.videoTimeSec - (walk.get(l.lapNumber) ?? l.videoTimeSec),
  }));
  if (shifts.some((l) => Math.abs(l.shiftSec) > 0.01)) {
    console.log("\nlap starts, and how far each moved off the transponder's walk:");
    for (const l of shifts) {
      console.log(
        `  L${String(l.lapNumber).padStart(2)}  ${l.shiftSec >= 0 ? "+" : ""}${l.shiftSec.toFixed(3)}s` +
          (l.detected ? "  (start/finish detected — measured)" : `  (clock model, drift ${l.driftSec.toFixed(3)}s)`)
      );
    }
  }
  if (review.clockDisagreements.length) {
    console.log("\nthe footage and the timing sheet disagree about these laps:");
    for (const d of review.clockDisagreements) {
      console.log(
        `  ${d.lapKey}  filmed ${d.filmedSec.toFixed(3)}s · sheet ${d.timedSec.toFixed(3)}s · ` +
          `${d.diffSec >= 0 ? "+" : ""}${(d.diffSec * 1000).toFixed(0)}ms over ${d.lines} lines`
      );
    }
  }

  if (truth) {
    grade(
      truth,
      at,
      new Set(review.suspect.map((r) => `me:${r.lapNumber}:${r.lineKey}`)),
      new Map(lines.map((l) => [l.lineKey, l.label]))
    );
  }

  const out = arg("json");
  if (out) writeFileSync(out, JSON.stringify({ summary, review: { found: review.found.length, suspect: review.suspect.length, missing: review.missing.length } }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
