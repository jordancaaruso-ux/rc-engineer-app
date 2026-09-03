/** What each line of the probe session is watched by, under each candidate recipe. */
import { readFileSync } from "node:fs";
import { RECIPE_VARIANTS } from "../src/lib/videoAnalysis/findCrossings/types";
import { bandHalfPxFor, lineGeom } from "../src/lib/videoAnalysis/findCrossings/geometry";

const probe = JSON.parse(
  readFileSync("C:/Users/Jordan/Documents/rc-autosnap-results/autosnap-me/probe-data.json", "utf8")
);
for (const name of process.argv.slice(2)) {
  const r = RECIPE_VARIANTS[name];
  if (!r) throw new Error(`unknown ${name}`);
  console.log(`## ${name}`);
  for (const l of probe.lines) {
    const g = lineGeom(l, 3840, 2160);
    const h = bandHalfPxFor(g, 3840, r);
    const cap = h * (r.endCapBands ?? 1);
    console.log(
      `   ${l.lineKey.padEnd(3)} line ${g.norm.toFixed(0).padStart(4)}px → zone ` +
        `${(g.norm + 2 * cap).toFixed(0).padStart(4)} x ${(2 * h).toFixed(0).padStart(3)}px`
    );
  }
}
