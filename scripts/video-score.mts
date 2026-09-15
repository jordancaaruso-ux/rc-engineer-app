/**
 * The video scorecard.
 *
 * For every video in `scripts/video-grading-set.json`: reset its grading clone, press "Find every
 * crossing" in a real Chrome (`dev-drive-scan.mts`), then grade what the scan wrote against
 *
 *   1. the transponder — the video's own start-line intervals vs the timing sheet's lap times,
 *      counted only where BOTH ends of the lap were seen on the picture (a walked start agrees
 *      with the sheet by construction, so it is not evidence);
 *   2. the truth files — crossings a person placed by eye, after each line's fixed offset is
 *      removed (the car's shadow pulls a blob centre a constant amount per line; that cancels in
 *      every comparison and is not an error);
 *   3. itself — how steady each line's crossing is from lap to lap, as a share of that lap.
 *
 * The headline is TRUSTED LAP ROWS: laps with every sector written, both ends seen on the start
 * line, and a length that matches the transponder within a frame. That is a row on the board a
 * driver can act on. Everything else is a guard rail.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/video-score.mts [--only 4480,4523] [--no-scan]
 *     [--headed] [--label NAME] [--vs e2e/.shots/score/<earlier>.json] [--from <earlier>.json]
 *
 * `--no-scan` grades what is already saved on the clones; pair it with `--from` so the "seen"
 * flags of that earlier run are reused (they live in the console, not the session). Writes ONLY
 * to the grading clones and to `e2e/.shots/score/`.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

type TruthSpec = { file: string; format: "picks" | "frozen"; excludeLines?: string[]; note?: string };
type Entry = {
  key: string;
  video: string;
  what: string;
  path: string;
  durationSec: number;
  sourceJobId: string;
  gradingJobId: string;
  truth?: TruthSpec[];
};
type Row = {
  driverRole: string;
  lapNumber: number;
  lineKey: string;
  videoTimeSec: number | null;
  source: string | null;
  suspect: boolean;
  claimedBy?: { by: string; key: string; lapNumber: number };
};

const FRAME_MS = 1000 / 29.97;
const WRONG_MS = 100;
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const only = flag("only")?.split(",").map((s) => s.trim()).filter(Boolean);
const label = flag("label") ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const noScan = has("no-scan");
const headed = has("headed");

const set = JSON.parse(readFileSync("scripts/video-grading-set.json", "utf8")) as { entries: Entry[] };
const entries = set.entries.filter((e) => !only || only.includes(e.key));
if (!entries.length) throw new Error("no entries match --only");
const prisma = new PrismaClient();

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))]!;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const ms = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "  —" : `${Math.round(v)}`.padStart(3));

// ---------------------------------------------------------------------------------------------
// The clone, reset: no marks, no scan, no traces, no measured starts. Anchors stay.
async function resetJob(id: string): Promise<string> {
  const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id }, select: { manualJson: true } });
  const mj = { ...(job.manualJson as Record<string, unknown>) } as Record<string, unknown>;
  mj.marks = [];
  delete mj.lastScan;
  delete mj.lastIdentify;
  delete mj.lastRace;
  mj.traces = {};
  const sessions = (mj.timingSessions as Array<Record<string, unknown>> | undefined) ?? [];
  mj.timingSessions = sessions.map((ts) => {
    const sync = { ...((ts.sync as Record<string, unknown>) ?? {}) };
    delete sync.perLapSfStart;
    delete sync.perLapSfEnd;
    return { ...ts, sync };
  });
  await prisma.videoAnalysisJob.update({ where: { id }, data: { manualJson: mj as never } });
  return new Date().toISOString();
}

type ScanInfo = {
  scanSec: number | null;
  reader: string;
  seen: Record<string, boolean>;
  /** How far each measured start moved from the transponder's walk, seconds. */
  drifts: Record<string, number>;
  /** The `[scan] learned …` lines: where each corner's window was aimed. */
  learned: string[];
  /** How many times the scan stopped to ask which car is the driver's (answered by the rig). */
  pickerAsked: number;
  startClock: string | null;
  pageErrors: string[];
  finished: boolean;
  summary: string | null;
};

/**
 * The driver's usual seconds-into-the-lap at each corner on the SOURCE job — the median over its
 * marks, against the walk from that driver's own anchor. What a driver who recognises their car
 * would tap when the scan asks.
 */
async function usualOffsets(sourceJobId: string, role = "me"): Promise<Record<string, number>> {
  const job = await prisma.videoAnalysisJob.findUnique({ where: { id: sourceJobId }, select: { manualJson: true } });
  const mj = job?.manualJson as {
    marks?: Array<{ driverRole: string; lineKey: string; videoTimeSec: number; lapNumber: number }>;
    timingSessions?: Array<{
      drivers?: Array<{ role: string; laps: Array<{ lapNumber: number; lapTimeSec: number }> }>;
      sync?: { anchor?: { lapNumber: number; anchorKind: string; videoTimeSec: number }; anchorByRole?: Record<string, { lapNumber: number; anchorKind: string; videoTimeSec: number }> };
    }>;
  } | undefined;
  if (!mj) return {};
  let driver: { laps: Array<{ lapNumber: number; lapTimeSec: number }> } | undefined;
  let anchor: { lapNumber: number; anchorKind: string; videoTimeSec: number } | undefined;
  for (const ts of mj.timingSessions ?? []) {
    const d = (ts.drivers ?? []).find((x) => x.role === role);
    if (d) {
      driver = d;
      anchor = ts.sync?.anchorByRole?.[role] ?? ts.sync?.anchor;
      break;
    }
  }
  if (!driver || !anchor) return {};
  const lapSec = new Map(driver.laps.map((l) => [l.lapNumber, l.lapTimeSec]));
  const walk = (n: number) => {
    let t = anchor!.videoTimeSec;
    if (anchor!.anchorKind === "sf_finish") t -= lapSec.get(anchor!.lapNumber) ?? 0;
    if (n > anchor!.lapNumber) for (let k = anchor!.lapNumber; k < n; k++) t += lapSec.get(k) ?? 0;
    if (n < anchor!.lapNumber) for (let k = n; k < anchor!.lapNumber; k++) t -= lapSec.get(k) ?? 0;
    return t;
  };
  const byLine = new Map<string, number[]>();
  for (const m of mj.marks ?? []) {
    if (m.driverRole !== role || m.lineKey === "sf") continue;
    byLine.set(m.lineKey, [...(byLine.get(m.lineKey) ?? []), m.videoTimeSec - walk(m.lapNumber)]);
  }
  const out: Record<string, number> = {};
  for (const [line, offs] of byLine) if (offs.length >= 2) out[line] = Number(median(offs).toFixed(3));
  return out;
}

function runScan(entry: Entry, usual: Record<string, number>): Promise<ScanInfo> {
  return new Promise((resolve) => {
    const argv = ["node_modules/tsx/dist/cli.mjs", "scripts/dev-drive-scan.mts", entry.gradingJobId, entry.path];
    if (!headed) argv.push("--headless");
    if (flag("recipe")) argv.push("--recipe", flag("recipe")!);
    // Nobody is at the keyboard: when the scan asks which car is the driver's, the rig taps the
    // picture nearest the driver's usual rhythm from the SOURCE job (a driver who knows their
    // own car), and says so. Counted per video as `pickerAsked`.
    argv.push("--auto-pick");
    if (Object.keys(usual).length) argv.push("--pick-offsets", JSON.stringify(usual));
    const child = spawn(process.execPath, argv, { windowsHide: true });
    const info: ScanInfo = { scanSec: null, reader: "?", seen: {}, drifts: {}, learned: [], pickerAsked: 0, startClock: null, pageErrors: [], finished: false, summary: null };
    let buf = "";
    const all: string[] = [];
    const onLine = (line: string) => {
      const t = line.trim();
      if (!t) return;
      all.push(t);
      const m = t.match(/^\[review\] start (\S+) L(\d+) ([\d.]+) (seen|walked) drift (-?[\d.]+)/);
      if (m) {
        info.seen[`${m[1]}:${m[2]}`] = m[4] === "seen";
        info.drifts[`${m[1]}:${m[2]}`] = Number(m[5]);
        return;
      }
      if (t.startsWith("[scan] learned")) info.learned.push(t.slice("[scan] ".length));
      if (t.startsWith("[rig] picker answered")) {
        info.pickerAsked++;
        info.learned.push(t.slice("[rig] ".length));
      }
      if (t.startsWith("[review] start-line clock")) info.startClock = t.slice("[review] ".length);
      if (t.startsWith("[frames]")) info.reader = t.slice("[frames] ".length);
      if (t.startsWith("PAGE ERROR")) info.pageErrors.push(t);
      if (t.startsWith("[review] timing sheet vs footage")) console.log(`    ${t}`);
      const took = t.match(/^scan took (\d+)s/);
      if (took) info.scanSec = Number(took[1]);
      if (/^found \d+ · held/.test(t)) {
        info.summary = t;
        info.finished = true;
      }
      if (t.includes("NO REVIEW LOGGED")) info.finished = false;
      if (/^\[scan\] .*STARVED/.test(t)) console.log(`    ${t}`);
      if (t.startsWith("could not reach") || t.startsWith("page says")) console.log(`    ${t}`);
    };
    const feed = (chunk: Buffer) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    };
    child.stdout.on("data", feed);
    child.stderr.on("data", feed);
    // The rig has its own deadline (`SCAN_DEADLINE_MIN`, default 15); this is only the backstop
    // above it. The 29-minute 4K practice (4521) takes over 25 minutes to scan.
    const killer = setTimeout(() => child.kill(), (Number(process.env.SCAN_DEADLINE_MIN ?? 15) + 5) * 60_000);
    child.on("close", () => {
      clearTimeout(killer);
      if (buf) onLine(buf);
      // The whole console — every `[scan]` and `[review]` line — kept beside the results, so a
      // question about one row can be answered without another scan.
      mkdirSync("e2e/.shots/score", { recursive: true });
      writeFileSync(`e2e/.shots/score/${label}-${entry.key}.log`, all.join("\n") + "\n", "utf8");
      resolve(info);
    });
  });
}

async function waitForScan(id: string, after: string): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id }, select: { manualJson: true } });
    const at = (job.manualJson as { lastScan?: { at?: string } })?.lastScan?.at;
    if (at && at > after) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
type Graded = {
  key: string;
  what: string;
  jobId: string;
  scanSec: number | null;
  speed: number | null;
  reader: string;
  pageErrors: number;
  finished: boolean;
  lastScanAt: string | null;
  seen: Record<string, boolean>;
  seenKnown: boolean;
  drifts: Record<string, number>;
  learned: string[];
  pickerAsked: number;
  drivers: string[];
  laps: {
    asked: number;
    complete: number;
    endsSeen: number;
    clockOk: number;
    trusted: number;
    incomplete: number;
    endsUnseen: number;
    clockOff: number;
    startsSeen: number;
    startsAsked: number;
  };
  rows: { total: number; ready: number; held: number; missing: number; heldClaimed: number; heldOdd: number; heldUnconfirmed: number };
  sf: { pairs: number; medianMs: number | null; p90Ms: number | null; worstMs: number | null; within1f: number; within2f: number; over: string[] };
  consistency: { perLine: Record<string, Record<string, number | null>>; worstMs: number | null; linesOver: number; basis: string };
  truth: {
    picks: number;
    excluded: number;
    graded: number;
    held: number;
    missing: number;
    wrong: number;
    within1fRaw: number;
    within1fDebiased: number;
    falsePositives: number;
    biasByLine: Record<string, number>;
    wrongList: string[];
  } | null;
  rowMap: Record<string, { t: number | null; held: boolean }>;
};

type TruthPick = { role: string; lap: number | null; line: string; t: number | null; due: number | null };

function loadTruth(spec: TruthSpec): { picks: TruthPick[]; excluded: number } {
  const j = JSON.parse(readFileSync(spec.file, "utf8"));
  let picks: TruthPick[];
  if (spec.format === "picks") {
    picks = (j.picks as Array<{ role: string; lap: number; line: string; t: number | null; due?: number }>).map((p) => ({
      role: p.role,
      lap: p.lap,
      line: p.line,
      t: p.t,
      due: p.due ?? null,
    }));
  } else {
    picks = (j.marks as Array<{ driverRole: string; lapNumber: number; lineKey: string; videoTimeSec: number }>).map((m) => ({
      role: m.driverRole,
      lap: m.lapNumber,
      line: m.lineKey,
      t: m.videoTimeSec,
      due: null,
    }));
  }
  const ex = new Set(spec.excludeLines ?? []);
  const kept = picks.filter((p) => !ex.has(p.line));
  return { picks: kept, excluded: picks.length - kept.length };
}

async function gradeEntry(entry: Entry, scan: ScanInfo | null, seenFrom?: Record<string, boolean>): Promise<Graded> {
  const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: entry.gradingJobId }, select: { manualJson: true } });
  const mj = job.manualJson as {
    lastScan?: { at: string; rows: Row[] };
    timingSessions?: Array<{
      drivers?: Array<{ role: string; driverName: string; laps: Array<{ lapNumber: number; lapTimeSec: number }> }>;
      sync?: { perLapSfStart?: Record<string, number>; perLapSfEnd?: Record<string, number> };
    }>;
  };
  const rows = mj.lastScan?.rows ?? [];
  const sheet = new Map<string, number>();
  const drivers: string[] = [];
  const starts: Record<string, number> = {};
  for (const ts of mj.timingSessions ?? []) {
    for (const d of ts.drivers ?? []) {
      drivers.push(`${d.role}=${d.driverName}`);
      for (const l of d.laps) sheet.set(`${d.role}:${l.lapNumber}`, l.lapTimeSec);
    }
    Object.assign(starts, ts.sync?.perLapSfStart ?? {});
  }
  const seen = scan ? scan.seen : seenFrom ?? {};
  const seenKnown = Object.keys(seen).length > 0;
  const isSeen = (key: string) => (seenKnown ? seen[key] === true : starts[key] != null);

  // Rows.
  const rowMap: Graded["rowMap"] = {};
  let ready = 0, held = 0, missing = 0, heldClaimed = 0, heldOdd = 0, heldUnconfirmed = 0;
  for (const r of rows) {
    rowMap[`${r.driverRole}:${r.lapNumber}:${r.lineKey}`] = { t: r.videoTimeSec, held: r.suspect };
    if (r.videoTimeSec == null) missing++;
    else if (r.suspect) {
      held++;
      // Why it was held: the field gave it to a rival, the window saw only a flicker, or the time
      // sits oddly against the driver's other laps.
      if (r.claimedBy && r.claimedBy.key !== r.driverRole) heldClaimed++;
      else if (r.source === "unconfirmed") heldUnconfirmed++;
      else heldOdd++;
    } else ready++;
  }

  // Laps.
  const linesByRole = new Map<string, Set<string>>();
  for (const r of rows) linesByRole.set(r.driverRole, (linesByRole.get(r.driverRole) ?? new Set()).add(r.lineKey));
  const lapKeys = [...new Set(rows.map((r) => `${r.driverRole}:${r.lapNumber}`))];
  const laps = { asked: lapKeys.length, complete: 0, endsSeen: 0, clockOk: 0, trusted: 0, incomplete: 0, endsUnseen: 0, clockOff: 0, startsSeen: 0, startsAsked: 0 };
  for (const key of lapKeys) {
    const [role, lapStr] = key.split(":") as [string, string];
    const lap = Number(lapStr);
    const lines = linesByRole.get(role) ?? new Set();
    const complete = [...lines].every((line) => {
      const r = rowMap[`${key}:${line}`];
      return r && r.t != null && !r.held;
    });
    const start = starts[key];
    const end = starts[`${role}:${lap + 1}`];
    const startSeen = isSeen(key);
    const endSeen = isSeen(`${role}:${lap + 1}`);
    const lapSec = sheet.get(key);
    const clockOk = start != null && end != null && lapSec != null && Math.abs((end - start - lapSec) * 1000) <= FRAME_MS;
    laps.startsAsked++;
    if (startSeen) laps.startsSeen++;
    if (complete) laps.complete++;
    if (startSeen && endSeen) laps.endsSeen++;
    if (clockOk) laps.clockOk++;
    if (complete && startSeen && endSeen && clockOk) laps.trusted++;
    else if (!complete) laps.incomplete++;
    else if (!(startSeen && endSeen)) laps.endsUnseen++;
    else laps.clockOff++;
  }

  // The transponder, seen ends only.
  const errs: number[] = [];
  const over: string[] = [];
  for (const key of Object.keys(starts)) {
    const [role, lapStr] = key.split(":") as [string, string];
    const lap = Number(lapStr);
    const next = `${role}:${lap + 1}`;
    if (!isSeen(key) || !isSeen(next) || starts[next] == null) continue;
    const lapSec = sheet.get(key);
    if (lapSec == null) continue;
    const err = (starts[next]! - starts[key]! - lapSec) * 1000;
    errs.push(Math.abs(err));
    if (Math.abs(err) > 2 * FRAME_MS) {
      const d = scan?.drifts ?? {};
      const drift = d[key] != null && d[next] != null ? ` (drift ${Math.round(d[key]! * 1000)}/${Math.round(d[next]! * 1000)}ms)` : "";
      over.push(`${role} L${lap} ${err > 0 ? "+" : ""}${Math.round(err)}ms${drift}`);
    }
  }
  const sf = {
    pairs: errs.length,
    medianMs: errs.length ? median(errs) : null,
    p90Ms: errs.length ? q(errs, 0.9) : null,
    worstMs: errs.length ? Math.max(...errs) : null,
    within1f: errs.filter((e) => e <= FRAME_MS).length,
    within2f: errs.filter((e) => e <= 2 * FRAME_MS).length,
    over,
  };

  // Lap-to-lap steadiness per line, as a share of the lap. Seen ends where there are enough.
  const perLine: Record<string, Record<string, number | null>> = {};
  let worst: number | null = null;
  let linesOver = 0;
  let basis = "seen ends";
  for (const [role, lines] of linesByRole) {
    perLine[role] = {};
    for (const line of [...lines].sort()) {
      const collect = (seenOnly: boolean) => {
        const fr: Array<{ f: number; len: number }> = [];
        for (const r of rows) {
          if (r.driverRole !== role || r.lineKey !== line || r.videoTimeSec == null || r.suspect) continue;
          const k = `${role}:${r.lapNumber}`;
          const nk = `${role}:${r.lapNumber + 1}`;
          const s = starts[k], e = starts[nk];
          if (s == null || e == null || e <= s) continue;
          if (seenOnly && !(isSeen(k) && isSeen(nk))) continue;
          fr.push({ f: (r.videoTimeSec - s) / (e - s), len: e - s });
        }
        return fr;
      };
      let fr = collect(true);
      if (fr.length < 3) {
        fr = collect(false);
        if (fr.length >= 3) basis = "all measured ends";
      }
      if (fr.length < 3) {
        perLine[role]![line] = null;
        continue;
      }
      const fm = median(fr.map((x) => x.f));
      const lenMed = median(fr.map((x) => x.len));
      const dev = median(fr.map((x) => Math.abs(x.f - fm))) * lenMed * 1000;
      perLine[role]![line] = dev;
      if (worst == null || dev > worst) worst = dev;
      if (dev > FRAME_MS) linesOver++;
    }
  }

  // The truth files.
  let truth: Graded["truth"] = null;
  if (entry.truth?.length) {
    const t = { picks: 0, excluded: 0, graded: 0, held: 0, missing: 0, wrong: 0, within1fRaw: 0, within1fDebiased: 0, falsePositives: 0, biasByLine: {} as Record<string, number>, wrongList: [] as string[] };
    const graded: Array<{ pick: TruthPick; d: number }> = [];
    for (const spec of entry.truth) {
      const { picks, excluded } = loadTruth(spec);
      t.excluded += excluded;
      for (const p of picks) {
        t.picks++;
        const same = rows.filter((r) => r.driverRole === p.role && r.lineKey === p.line && r.videoTimeSec != null);
        if (p.t == null) {
          // No real crossing here: the only right answer is silence.
          if (p.due != null && same.some((r) => !r.suspect && Math.abs(r.videoTimeSec! - p.due!) <= 1.0)) t.falsePositives++;
          continue;
        }
        let best: Row | null = null;
        for (const r of same) if (!best || Math.abs(r.videoTimeSec! - p.t) < Math.abs(best.videoTimeSec! - p.t)) best = r;
        if (!best || Math.abs(best.videoTimeSec! - p.t) > 1.5) {
          t.missing++;
          continue;
        }
        if (best.suspect) {
          t.held++;
          continue;
        }
        graded.push({ pick: p, d: (best.videoTimeSec! - p.t) * 1000 });
      }
    }
    t.graded = graded.length;
    const byLine = new Map<string, number[]>();
    for (const g of graded) byLine.set(g.pick.line, [...(byLine.get(g.pick.line) ?? []), g.d]);
    for (const [line, ds] of byLine) t.biasByLine[line] = ds.length >= 2 ? median(ds) : 0;
    for (const g of graded) {
      const bias = t.biasByLine[g.pick.line] ?? 0;
      if (Math.abs(g.d) <= FRAME_MS) t.within1fRaw++;
      if (Math.abs(g.d - bias) <= FRAME_MS) t.within1fDebiased++;
      if (Math.abs(g.d - bias) > WRONG_MS) {
        t.wrong++;
        t.wrongList.push(`${g.pick.role} L${g.pick.lap} ${g.pick.line} ${g.d > 0 ? "+" : ""}${Math.round(g.d)}ms (line offset ${Math.round(bias)})`);
      }
    }
    truth = t;
  }

  return {
    key: entry.key,
    what: entry.what,
    jobId: entry.gradingJobId,
    scanSec: scan?.scanSec ?? null,
    speed: scan?.scanSec != null ? scan.scanSec / entry.durationSec : null,
    reader: scan?.reader ?? "?",
    pageErrors: scan?.pageErrors.length ?? 0,
    finished: scan ? scan.finished : rows.length > 0,
    lastScanAt: mj.lastScan?.at ?? null,
    seen,
    seenKnown,
    drifts: scan?.drifts ?? {},
    learned: scan?.learned ?? [],
    pickerAsked: scan?.pickerAsked ?? 0,
    drivers,
    laps,
    rows: { total: rows.length, ready, held, missing, heldClaimed, heldOdd, heldUnconfirmed },
    sf,
    consistency: { perLine, worstMs: worst, linesOver, basis },
    truth,
    rowMap,
  };
}

// ---------------------------------------------------------------------------------------------
function printEntry(g: Graded) {
  const L = g.laps;
  console.log(`\n${g.key}  ${g.what}  [${g.jobId}]`);
  console.log(`  drivers: ${g.drivers.join(", ")}`);
  console.log(
    `  scan: ${g.scanSec != null ? `${g.scanSec}s (${(g.speed! * 100).toFixed(0)}% of the footage)` : "not run"} · reader: ${g.reader}` +
      (g.pageErrors ? ` · PAGE ERRORS ${g.pageErrors}` : "") +
      (g.pickerAsked ? ` · PICKER ASKED ${g.pickerAsked}×` : "") +
      (g.finished ? "" : " · DID NOT FINISH")
  );
  console.log(
    `  TRUSTED LAP ROWS ${L.trusted}/${L.asked}` +
      `   (complete ${L.complete} · both ends seen ${L.endsSeen} · clock ok ${L.clockOk})` +
      `   lost to: sectors ${L.incomplete} · ends ${L.endsUnseen} · clock ${L.clockOff}` +
      (g.seenKnown ? "" : "   [seen flags unknown — measured starts counted as seen]")
  );
  console.log(
    `  rows ${g.rows.total}: ready ${g.rows.ready} · held ${g.rows.held} (rival's ${g.rows.heldClaimed} · odd ${g.rows.heldOdd} · unconfirmed ${g.rows.heldUnconfirmed}) · missing ${g.rows.missing}   starts seen ${L.startsSeen}/${L.startsAsked}`
  );
  console.log(
    `  vs transponder (seen ends): ${g.sf.pairs} laps · median ${ms(g.sf.medianMs)}ms · p90 ${ms(g.sf.p90Ms)}ms · worst ${ms(g.sf.worstMs)}ms · within 1f ${g.sf.within1f} · 2f ${g.sf.within2f}` +
      (g.sf.over.length ? `   OVER 2f: ${g.sf.over.join(", ")}` : "")
  );
  const lines = Object.entries(g.consistency.perLine)
    .map(([role, m]) => `${role} ` + Object.entries(m).map(([l, v]) => `${l}:${v == null ? "—" : Math.round(v)}`).join(" "))
    .join("  |  ");
  console.log(`  steadiness (ms, ${g.consistency.basis}): ${lines}   worst ${ms(g.consistency.worstMs)}ms · lines over a frame ${g.consistency.linesOver}`);
  if (g.truth) {
    const t = g.truth;
    console.log(
      `  vs eye truth: ${t.picks} picks (${t.excluded} excluded) · graded ${t.graded} · held ${t.held} · missing ${t.missing} · WRONG ${t.wrong} · false positives ${t.falsePositives}` +
        ` · within 1f raw ${t.within1fRaw} / debiased ${t.within1fDebiased} · line offsets ${Object.entries(t.biasByLine).map(([l, b]) => `${l}:${Math.round(b)}`).join(" ")}`
    );
    for (const w of t.wrongList) console.log(`     wrong: ${w}`);
  }
}

function printTotals(gs: Graded[]) {
  const asked = gs.reduce((a, g) => a + g.laps.asked, 0);
  const trusted = gs.reduce((a, g) => a + g.laps.trusted, 0);
  const complete = gs.reduce((a, g) => a + g.laps.complete, 0);
  const ends = gs.reduce((a, g) => a + g.laps.endsSeen, 0);
  const clock = gs.reduce((a, g) => a + g.laps.clockOk, 0);
  const sfPairs = gs.reduce((a, g) => a + g.sf.pairs, 0);
  const sf1 = gs.reduce((a, g) => a + g.sf.within1f, 0);
  const sf2 = gs.reduce((a, g) => a + g.sf.within2f, 0);
  const wrong = gs.reduce((a, g) => a + (g.truth?.wrong ?? 0), 0);
  const fp = gs.reduce((a, g) => a + (g.truth?.falsePositives ?? 0), 0);
  const linesOver = gs.reduce((a, g) => a + g.consistency.linesOver, 0);
  const slow = gs.filter((g) => g.speed != null && g.speed > 1 / 3).map((g) => g.key);
  const unfinished = gs.filter((g) => !g.finished).map((g) => g.key);
  console.log(`\n${"=".repeat(100)}`);
  console.log(`HEADLINE  trusted lap rows ${trusted}/${asked} (${asked ? Math.round((100 * trusted) / asked) : 0}%)   complete ${complete} · both ends seen ${ends} · clock ok ${clock}`);
  console.log(
    `GUARDS    transponder: ${sf1}/${sfPairs} within a frame, ${sf2}/${sfPairs} within two ${sf2 === sfPairs && sf1 >= 0.95 * sfPairs ? "✓" : "✗"}` +
      `   wrong marks ${wrong} + false positives ${fp} ${wrong + fp === 0 ? "✓" : "✗"}` +
      `   lines over a frame ${linesOver} ${linesOver === 0 ? "✓" : "✗"}` +
      `   speed ${slow.length ? `✗ (${slow.join(",")})` : "✓"}` +
      (unfinished.length ? `   UNFINISHED ${unfinished.join(",")}` : "")
  );
  console.log(`          per video trusted: ${gs.map((g) => `${g.key} ${g.laps.trusted}/${g.laps.asked}`).join(" · ")}`);
}

function diffAgainst(prevPath: string, gs: Graded[]) {
  const prev = JSON.parse(readFileSync(prevPath, "utf8")) as { label: string; entries: Graded[] };
  console.log(`\n${"-".repeat(100)}\nCHANGES vs ${prev.label}`);
  for (const g of gs) {
    const p = prev.entries.find((e) => e.key === g.key);
    if (!p) {
      console.log(`  ${g.key}: not in the earlier run`);
      continue;
    }
    const d = (a: number | null | undefined, b: number | null | undefined, unit = "") =>
      a == null || b == null ? `${a ?? "—"}→${b ?? "—"}${unit}` : a === b ? `${b}${unit} (=)` : `${a}→${b}${unit}`;
    console.log(
      `  ${g.key}: trusted ${d(p.laps.trusted, g.laps.trusted)}/${g.laps.asked} · ready ${d(p.rows.ready, g.rows.ready)} · held ${d(p.rows.held, g.rows.held)} · missing ${d(p.rows.missing, g.rows.missing)}` +
        ` · sf median ${d(p.sf.medianMs == null ? null : Math.round(p.sf.medianMs), g.sf.medianMs == null ? null : Math.round(g.sf.medianMs), "ms")}` +
        ` · steadiness worst ${d(p.consistency.worstMs == null ? null : Math.round(p.consistency.worstMs), g.consistency.worstMs == null ? null : Math.round(g.consistency.worstMs), "ms")}` +
        (g.truth && p.truth ? ` · wrong ${d(p.truth.wrong, g.truth.wrong)} · truth held ${d(p.truth.held, g.truth.held)} · truth missing ${d(p.truth.missing, g.truth.missing)}` : "") +
        ` · scan ${d(p.scanSec, g.scanSec, "s")}`
    );
    const moved: string[] = [], appeared: string[] = [], vanished: string[] = [];
    const keys = new Set([...Object.keys(p.rowMap ?? {}), ...Object.keys(g.rowMap)]);
    for (const k of keys) {
      const a = p.rowMap?.[k], b = g.rowMap[k];
      const aReady = a && a.t != null && !a.held, bReady = b && b.t != null && !b.held;
      if (aReady && bReady && Math.abs(a!.t! - b!.t!) * 1000 > FRAME_MS) moved.push(`${k} ${(b!.t! - a!.t!) > 0 ? "+" : ""}${Math.round((b!.t! - a!.t!) * 1000)}ms`);
      else if (!aReady && bReady) appeared.push(k);
      else if (aReady && !bReady) vanished.push(k);
    }
    const show = (name: string, xs: string[]) => xs.length ? `     ${name} ${xs.length}: ${xs.slice(0, 12).join(", ")}${xs.length > 12 ? " …" : ""}` : "";
    for (const s of [show("moved > 1 frame", moved), show("newly written", appeared), show("no longer written", vanished)]) if (s) console.log(s);
  }
}

// ---------------------------------------------------------------------------------------------
const started = Date.now();
let code = "?";
try {
  code = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() + (execSync("git status --porcelain -- src", { encoding: "utf8" }).trim() ? "+dirty" : "");
} catch {}
console.log(`video scorecard · ${label} · code ${code} · ${entries.length} video${entries.length === 1 ? "" : "s"}${noScan ? " · grading saved scans" : ""}${headed ? " · headed" : ""}`);
const from = flag("from") ? (JSON.parse(readFileSync(flag("from")!, "utf8")) as { entries: Graded[] }) : null;

const results: Graded[] = [];
for (const entry of entries) {
  if (!existsSync(entry.path)) {
    console.log(`\n${entry.key}: video missing at ${entry.path} — skipped`);
    continue;
  }
  let scan: ScanInfo | null = null;
  if (!noScan) {
    console.log(`\n▶ ${entry.key} ${entry.what}: resetting ${entry.gradingJobId} and scanning ${path.basename(entry.path)}`);
    const resetAt = await resetJob(entry.gradingJobId);
    const usual = await usualOffsets(entry.sourceJobId);
    if (Object.keys(usual).length) console.log(`  usual offsets (source job, me): ${Object.entries(usual).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ")}`);
    scan = await runScan(entry, usual);
    const landed = await waitForScan(entry.gradingJobId, resetAt);
    if (!landed) console.log(`  the scan never landed on the clone (no lastScan after ${resetAt})`);
    console.log(`  ${scan.summary ?? "(no summary line)"}${scan.startClock ? ` · ${scan.startClock}` : ""}`);
    for (const l of scan.learned) console.log(`    ${l}`);
  }
  const prevSeen = from?.entries.find((e) => e.key === entry.key)?.seen;
  const g = await gradeEntry(entry, scan, prevSeen);
  results.push(g);
  printEntry(g);
}
printTotals(results);
if (flag("vs")) diffAgainst(flag("vs")!, results);

mkdirSync("e2e/.shots/score", { recursive: true });
const outPath = `e2e/.shots/score/${label}.json`;
writeFileSync(outPath, JSON.stringify({ label, code, at: new Date().toISOString(), entries: results }, null, 1), "utf8");
console.log(`\nsaved ${outPath} · ${Math.round((Date.now() - started) / 1000)}s`);
await prisma.$disconnect();
