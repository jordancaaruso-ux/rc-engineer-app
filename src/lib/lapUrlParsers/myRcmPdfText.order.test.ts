/**
 * Run: `npm run test:myrcm-pdf`  (react-server condition — `myRcmPdfText.ts` is `server-only`)
 *
 * Two copies of pdf.js share one process on the server: this file's (5.4, the browser preview's
 * pin) and the one `pdf-to-img` nests to rasterise setup sheets (5.6). In Node both discover a
 * worker through `globalThis.pdfjsWorker` and each caches what it finds for the life of the
 * process, so before `loadPdfjs` whichever ran first broke the other:
 *
 *   sheet → laps : "API 5.4 does not match Worker 5.6" on every lap-sheet upload after
 *   laps → sheet : every setup sheet in that process failed the same way
 *
 * A test that runs one of them can never see this. This one runs both, in each order, in a child
 * process each (`myRcmPdfText.order.child.ts`) — the cache is per process, so the two orders
 * cannot share one.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

function runOrder(order: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const child = path.join(here, "myRcmPdfText.order.child.ts");
  const cwd = path.resolve(here, "../../..");
  const res = spawnSync(
    process.execPath,
    ["--conditions=react-server", "--import", "tsx", child, order],
    { cwd, encoding: "utf8", timeout: 120_000 }
  );
  const lines = (res.stdout + res.stderr)
    .split(/\r?\n/)
    .filter((l) => /^(laps:|sheet:|FAIL)/.test(l));
  return lines.join("\n") || `(no output) status=${res.status}\n${res.stderr}`;
}

test("a setup sheet rendered first does not hijack the lap reader", () => {
  assert.equal(runOrder("sheet,laps,sheet"), "sheet:ok laps:727 sheet:ok");
});

test("a lap sheet read first does not hijack the setup-sheet renderer", () => {
  assert.equal(runOrder("laps,sheet,laps"), "laps:727 sheet:ok laps:727");
});
