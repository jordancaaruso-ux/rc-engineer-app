/**
 * Re-run everything after the read, over a dump of what the read saw.
 *
 *   npx tsx scripts/dev-replay-race.mts <dump.json> [--truth file] [--role me] [key=value …]
 *
 * Reading a race costs a browser and a minute. Choosing paths out of what was seen, naming them
 * against the sheet, and reading the sectors off them costs nothing — so a rule that has to be
 * tried ten times should not be ten minutes of decoding. `scripts/dev-drive-race.mts --dump`
 * writes the file; this replays `link → name → sectorCrossings` over it and prints the same
 * summary the browser prints, plus the grading table when a truth set is given.
 *
 * Any `LinkParams` field can be overridden from the command line, so a sweep is a shell loop:
 *
 *   for g in 0.5 1.0 1.5; do npx tsx scripts/dev-replay-race.mts dump.json maxGapSec=$g; done
 */
import { readFileSync } from "node:fs";
import { defaultLinkParams, linkTracklets, type LinkParams } from "../src/lib/videoAnalysis/racePass/link";
import { nameByTheSheet } from "../src/lib/videoAnalysis/racePass/name";
import { sectorCrossings } from "../src/lib/videoAnalysis/racePass/sectorCrossings";
import type { RacePassDump } from "../src/lib/videoAnalysis/racePass/browserRace";

const args = process.argv.slice(2);
const flag = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const VALUED = new Set(["--truth", "--role"]);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(args[i - 1]!)));
const dumpPath = positional[0];
if (!dumpPath) {
  console.error("usage: dev-replay-race.mts <dump.json> [--truth file] [--role me] [key=value …]");
  process.exit(2);
}
const overrides = positional.slice(1).filter((a) => a.includes("="));
const onlyRole = flag("role");
const FRAME_SEC = 1 / 30;

const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as RacePassDump;
const params: LinkParams = defaultLinkParams(dump.carPx);
for (const o of overrides) {
  const [k, v] = o.split("=");
  if (!k || v == null || !(k in params)) {
    console.error(`unknown link setting "${k}"`);
    process.exit(2);
  }
  (params as unknown as Record<string, number>)[k] = Number(v);
}
const changed = overrides.length ? ` · ${overrides.join(" ")}` : "";
console.log(
  `${dump.frames.length} frames · car ${dump.carPx.toFixed(0)}px · ${dump.sheet.length} drivers · ${dump.lines.length} lines${changed}`
);

const linked = linkTracklets(dump.frames, params);
const lives = linked.tracklets.map((t) => t.points[t.points.length - 1]!.t - t.points[0]!.t).sort((a, b) => a - b);
const ended: Record<string, number> = {};
for (const t of linked.tracklets) ended[t.endedBy] = (ended[t.endedBy] ?? 0) + 1;
console.log(
  `paths ${linked.tracklets.length} · standing ${linked.standing} short ${linked.tooShort} merges ${linked.merges}` +
    ` · life median ${(lives[lives.length >> 1] ?? 0).toFixed(2)}s p90 ${(lives[Math.floor(lives.length * 0.9)] ?? 0).toFixed(2)}s longest ${(lives[lives.length - 1] ?? 0).toFixed(1)}s` +
    ` · ended ${Object.entries(ended).map(([k, v]) => `${k} ${v}`).join(" ")}`
);

const sfLine = dump.lines.find((l) => l.lineKey === dump.sfKey)!;
const cornerLines = dump.lines.filter((l) => l.lineKey !== dump.sfKey).sort((a, b) => a.sortOrder - b.sortOrder);
const candidatesByLine = new Map(Object.entries(dump.strip));

const named = nameByTheSheet({
  tracklets: linked.tracklets,
  sfLine,
  frameW: dump.frameW,
  frameH: dump.frameH,
  sheet: dump.sheet,
  sfCandidates: candidatesByLine.get(dump.sfKey) ?? [],
  carPx: dump.carPx,
});
console.log(
  `named ${dump.sheet
    .map((d) => `${d.name.split(" ")[0]} ${named.laps.filter((l) => l.key === d.key).length}/${Math.max(0, d.laps.length - 1)}`)
    .join(" ")} · unnamed ${named.unnamed} · ties ${named.ties.length} · cuts ${named.cuts} · bridged ${named.bridged} · ${(named.namedShare * 100).toFixed(0)}% · ${named.verdict}`
);
if (named.sheetCheck) {
  console.log(
    `sheet check ${named.sheetCheck.laps} laps · median ${named.sheetCheck.medianMs.toFixed(0)}ms worst ${named.sheetCheck.worstMs.toFixed(0)}ms`
  );
}
const covers = named.laps
  .map((l) => l.points.length / Math.max(1, Math.round((l.endSec - l.startSec) * 30)))
  .sort((a, b) => a - b);
console.log(
  `lap coverage median ${((covers[covers.length >> 1] ?? 0) * 100).toFixed(0)}% · best ${((covers[covers.length - 1] ?? 0) * 100).toFixed(0)}% · whole-path laps ${named.laps.filter((l) => l.pathComplete).length}/${named.laps.length}`
);

const sectors = sectorCrossings({
  laps: named.laps,
  lines: cornerLines,
  frameW: dump.frameW,
  frameH: dump.frameH,
  candidatesByLine,
  carPx: dump.carPx,
});
const found = sectors.crossings.filter((c) => !c.unsure).length;
console.log(
  `crossings ${sectors.crossings.length} (${found} sure, ${sectors.crossings.length - found} unsure) · missing ${sectors.missing.length}`
);
const nears = sectors.missing
  .map((m) => m.nearestCarLengths)
  .filter((n): n is number => n != null)
  .sort((a, b) => a - b);
if (nears.length) {
  console.log(
    `  missing were median ${(nears[nears.length >> 1] ?? 0).toFixed(1)} car lengths from their line, best ${(nears[0] ?? 0).toFixed(1)}`
  );
}

const truthPath = flag("truth");
if (truthPath) {
  const truth = JSON.parse(readFileSync(truthPath, "utf8")) as {
    picks?: Array<{ role: string; lap: number; line: string; t: number | null }>;
  };
  const picks = (truth.picks ?? []).filter((p) => (onlyRole ? p.role === onlyRole : true));
  const errs: number[] = [];
  let missed = 0;
  let invented = 0;
  let absent = 0;
  for (const p of picks) {
    const got = sectors.crossings.find(
      (c) => (c.role ?? c.key) === p.role && c.lapNumber === p.lap && c.lineKey === p.line
    );
    if (p.t == null) {
      absent++;
      if (got) invented++;
      continue;
    }
    if (got) errs.push(Math.abs(got.t - p.t));
    else missed++;
  }
  const within = errs.filter((x) => x <= FRAME_SEC).length;
  const s = [...errs].sort((a, b) => a - b);
  console.log(
    `truth: found ${errs.length}/${picks.length - absent} · within a frame ${within} · median ${((s[s.length >> 1] ?? NaN) * 1000).toFixed(0)}ms · missed ${missed} · invented ${invented}/${absent}`
  );
  if (args.includes("--detail")) {
    for (const p of picks) {
      const got = sectors.crossings.find(
        (c) => (c.role ?? c.key) === p.role && c.lapNumber === p.lap && c.lineKey === p.line
      );
      const gap = sectors.missing.find(
        (m) => (m.role ?? m.key) === p.role && m.lapNumber === p.lap && m.lineKey === p.line
      );
      console.log(
        `  ${p.role.padEnd(11)} L${String(p.lap).padStart(2)} ${p.line}  truth ${p.t == null ? " NONE  " : p.t.toFixed(3)}  ` +
          (got
            ? `pass ${got.t.toFixed(3)} (${p.t == null ? "invented" : `${((got.t - p.t) * 1000).toFixed(0)}ms`})${got.unsure ? " unsure" : ""}`
            : `missing · nearest ${gap?.nearestCarLengths == null ? "no path" : gap.nearestCarLengths.toFixed(1) + " car lengths"}`)
      );
    }
  }
}
