/**
 * Grade a race pass: against the timing sheet, and against whatever the job already had.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/dev-grade-race.mts <jobId> <race log> [--role me]
 *
 * `<race log>` is what `scripts/dev-drive-race.mts --out` wrote: the page's own `[race]` and
 * `[review]` lines. The job supplies two independent things to check against —
 *
 *  - **The timing sheet.** Two consecutive start-line crossings must be the sheet's lap time
 *    apart. Nothing in the picture is involved, so this is free ground truth and it is the one
 *    check that cannot be argued with.
 *  - **The marks already on the job.** Those came from the strip scan. Agreement means both
 *    methods found the same thing; disagreement means one of them is wrong, and which one is a
 *    question for the footage — this prints them so they can be looked at rather than averaged.
 *
 * Nothing is written.
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseManualVideoSession } from "../src/lib/manualVideoAnalysis/types";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")));
const [jobId, logPath] = positional;
if (!jobId || !logPath) {
  console.error("usage: dev-grade-race.mts <jobId> <race log> [--role me]");
  process.exit(2);
}
const onlyRole = flag("role");
/** One frame at 30fps. */
const FRAME_SEC = 1 / 30;

type Read = { kind: "found" | "suspect" | "missing"; role: string; lap: number; line: string; t: number | null; note: string };

const log = readFileSync(logPath, "utf8").split(/\r?\n/);
const reads: Read[] = [];
for (const raw of log) {
  const line = raw.trim();
  let m = /^\[review\] (found|suspect) (\S+) L(\d+) (\S+) ([\d.]+) (.*)$/.exec(line);
  if (m) {
    reads.push({
      kind: m[1] as "found" | "suspect",
      role: m[2]!,
      lap: Number(m[3]),
      line: m[4]!,
      t: Number(m[5]),
      note: m[6]!.trim(),
    });
    continue;
  }
  m = /^\[review\] missing (\S+) L(\d+) (\S+) /.exec(line);
  if (m) {
    reads.push({ kind: "missing", role: m[1]!, lap: Number(m[2]), line: m[3]!, t: null, note: "" });
  }
}
const named = log.find((l) => l.includes("[race] named"));
const sheetLine = log.find((l) => l.includes("[race] sheet check"));
const readLine = log.find((l) => l.includes("[race] read "));
const trackletLine = log.find((l) => l.includes("[race] car "));

console.log(`${reads.length} readings out of the log`);
if (readLine) console.log(`  ${readLine.trim()}`);
if (trackletLine) console.log(`  ${trackletLine.trim()}`);
if (named) console.log(`  ${named.trim()}`);
if (sheetLine) console.log(`  ${sheetLine.trim()}`);

const prisma = new PrismaClient();
const job = await prisma.videoAnalysisJob.findUniqueOrThrow({ where: { id: jobId } });
const session = parseManualVideoSession(job.manualJson);
if (!session) throw new Error("no session on this job");

const marks = session.marks.filter((m) => (onlyRole ? m.driverRole === onlyRole : true));
const byKey = new Map(marks.map((m) => [`${m.driverRole}:${m.lapNumber}:${m.lineKey}`, m.videoTimeSec]));

const rows = reads.filter((r) => (onlyRole ? r.role === onlyRole : true));
const agree: number[] = [];
const differ: Array<{ r: Read; was: number }> = [];
let onlyPass = 0;
let onlyMarks = 0;

for (const r of rows) {
  const key = `${r.role}:${r.lap}:${r.line}`;
  const was = byKey.get(key);
  if (r.t == null) {
    if (was != null) onlyMarks++;
    continue;
  }
  if (was == null) {
    onlyPass++;
    continue;
  }
  const d = Math.abs(r.t - was);
  if (d <= FRAME_SEC) agree.push(d);
  else differ.push({ r, was });
}

const stat = (xs: number[]) => {
  if (!xs.length) return "none";
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))]!;
  return `median ${(q(0.5) * 1000).toFixed(0)}ms p90 ${(q(0.9) * 1000).toFixed(0)}ms worst ${(s[s.length - 1]! * 1000).toFixed(0)}ms`;
};

console.log(`\nagainst the ${marks.length} marks already on the job${onlyRole ? ` for ${onlyRole}` : ""}:`);
console.log(`  agree within a frame: ${agree.length} · ${stat(agree)}`);
console.log(`  disagree by more:     ${differ.length}`);
console.log(`  the pass found, the marks did not: ${onlyPass}`);
console.log(`  the marks had, the pass did not:   ${onlyMarks}`);

if (differ.length) {
  console.log(`\n  every disagreement — one of the two is wrong, and the footage says which:`);
  for (const { r, was } of differ.sort((a, b) => Math.abs(b.r.t! - b.was) - Math.abs(a.r.t! - a.was))) {
    console.log(
      `    ${r.role} L${String(r.lap).padStart(2)} ${r.line}  pass ${r.t!.toFixed(3)}  marks ${was.toFixed(3)}  ${((r.t! - was) * 1000).toFixed(0)}ms  ${r.kind}${r.note ? " " + r.note : ""}`
    );
  }
}

// Hand-checked crossings, where a truth set exists. This is the only comparison that settles
// anything: agreeing with the marks means both methods did the same thing, right or wrong.
const truthPath = flag("truth");
if (truthPath) {
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as {
    picks?: Array<{ role: string; lap: number; line: string; t: number | null; confidence?: string }>;
  };
  const picks = (truth.picks ?? []).filter((p) => (onlyRole ? p.role === onlyRole : true));
  const passErr: number[] = [];
  const markErr: number[] = [];
  const table: string[] = [];
  let passMissed = 0;
  let markMissed = 0;
  // A pick with no time is a place the car demonstrably did NOT cross — it ran wide of the drawn
  // segment. Reporting nothing there is the right answer and reporting something is an invention,
  // which is the exact fault this whole rebuild exists for. Scored separately, never averaged in.
  let passInvented = 0;
  let markInvented = 0;
  let absent = 0;
  for (const p of picks) {
    const key = `${p.role}:${p.lap}:${p.line}`;
    const got = rows.find((r) => `${r.role}:${r.lap}:${r.line}` === key && r.t != null);
    const was = byKey.get(key);
    if (p.t == null) {
      absent++;
      if (got?.t != null) passInvented++;
      if (was != null) markInvented++;
      table.push(
        `    ${p.role.padEnd(11)} L${String(p.lap).padStart(2)} ${p.line}  truth  NONE   ` +
          `pass ${got?.t != null ? `INVENTED ${got.t.toFixed(3)}` : "     none"}  ` +
          `marks ${was != null ? `INVENTED ${was.toFixed(3)}` : "     none"}`
      );
      continue;
    }
    if (got?.t != null) passErr.push(Math.abs(got.t - p.t));
    else passMissed++;
    if (was != null) markErr.push(Math.abs(was - p.t));
    else markMissed++;
    table.push(
      `    ${p.role.padEnd(11)} L${String(p.lap).padStart(2)} ${p.line}  truth ${p.t.toFixed(3)}  ` +
        `pass ${got?.t != null ? `${((got.t - p.t) * 1000).toFixed(0)}ms`.padStart(8) : "  missing"}  ` +
        `marks ${was != null ? `${((was - p.t) * 1000).toFixed(0)}ms`.padStart(8) : "  missing"}${got?.kind === "suspect" ? "  (held)" : ""}`
    );
  }
  const within = (xs: number[]) => xs.filter((x) => x <= FRAME_SEC).length;
  console.log(`\nagainst ${picks.length} hand-checked crossings (${truthPath}), ${absent} of which should not exist:`);
  console.log(
    `  the race pass:  found ${passErr.length}, within a frame ${within(passErr)}/${passErr.length} · ${stat(passErr)} · missed ${passMissed} · invented ${passInvented}/${absent}`
  );
  console.log(
    `  the marks:      found ${markErr.length}, within a frame ${within(markErr)}/${markErr.length} · ${stat(markErr)} · missed ${markMissed} · invented ${markInvented}/${absent}`
  );
  console.log(table.join("\n"));
}

const held = rows.filter((r) => r.kind === "suspect");
const gone = rows.filter((r) => r.kind === "missing");
console.log(`\nheld back by the pass: ${held.length}`);
for (const r of held) console.log(`    ${r.role} L${r.lap} ${r.line} ${r.t?.toFixed(3)} ${r.note}`);
console.log(`not answered by the pass: ${gone.length}`);
for (const r of gone.slice(0, 20)) console.log(`    ${r.role} L${r.lap} ${r.line}`);
if (gone.length > 20) console.log(`    …and ${gone.length - 20} more`);

await prisma.$disconnect();
