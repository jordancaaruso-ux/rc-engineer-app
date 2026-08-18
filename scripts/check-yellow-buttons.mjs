/**
 * Guard: every yellow button wears the shared face.
 *
 * There were 67 hand-styled yellow buttons before the 2026-08-18 sweep, and the
 * reason there were 67 is that nothing stopped the 68th. This is that stop.
 *
 * The rule: a class string holding BOTH a yellow fill (`bg-primary`, exact —
 * never `bg-primary/40`, never `bg-primary-ink`) and dark-on-yellow text
 * (`text-primary-foreground`) is a button, and must carry `primary-face`.
 *
 * Exempt: the three hero buttons, which wear the sheen as a child layer
 * (`.logrun-fx`) plus the outward aura (`.logrun-glow`). Adding the face to them
 * would give them the band twice. That aura is how the app marks its single #1
 * action — it stays on three buttons, deliberately.
 *
 * Not covered, and fine: fills without a text colour (progress bars, ticks,
 * skewed marks) are not buttons and stay flat.
 *
 * Run: `npm run check:yellow`
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const FILL = /(^|[\s"])bg-primary(?=[\s"]|$)/;
const INK = /text-primary-foreground/;
const EXEMPT = ["primary-face", "logrun-fx", "logrun-glow"];

const files = execSync('git ls-files "src/**/*.tsx"', { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const offenders = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    // Double-quoted, single-line strings only: matching every quote style walks
    // into apostrophes in prose and mis-pairs everything after them.
    for (const m of line.matchAll(/"([^"\n]*)"/g)) {
      const body = m[1];
      if (!FILL.test(body) || !INK.test(body)) continue;
      if (EXEMPT.some((e) => body.includes(e))) continue;
      offenders.push(`${file}:${i + 1}  ${body.trim().slice(0, 90)}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(
    `\n${offenders.length} yellow button${offenders.length === 1 ? "" : "s"} missing \`primary-face\`:\n`
  );
  console.error(offenders.map((o) => `  ${o}`).join("\n"));
  console.error(
    "\nAdd `primary-face` beside `bg-primary`, or use the shared Button / ButtonLink.\n" +
      "If it is not a button (a progress bar, a tick), it should not carry `text-primary-foreground`.\n"
  );
  process.exit(1);
}

console.log(`Yellow buttons: all faced (${files.length} files scanned).`);
