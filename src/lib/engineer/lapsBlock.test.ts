/**
 * Run: `npm run test:engineer-history`.
 *
 * The LAPS block's figures are what the Engineer quotes when a driver asks "was that actually
 * faster?", so every number under a driver's laps must be the arithmetic it claims to be.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lapsFigures,
  renderLapsBlock,
  MAX_LAPS_SESSIONS,
  type LapsSession,
} from "@/lib/engineer/lapsBlock";

const laps = (...xs: number[]): number[] => xs;

test("figures: best, top5, median, last five vs first five, spread", () => {
  // Ten laps: first five around 17.6, last five around 17.9, one binned lap in the middle.
  const f = lapsFigures(laps(17.6, 17.5, 17.7, 17.6, 17.6, 25.0, 17.9, 17.8, 18.0, 17.9));
  assert.ok(f);
  assert.equal(f.best, 17.5);
  assert.equal(f.top5.toFixed(3), ((17.5 + 17.6 + 17.6 + 17.6 + 17.7) / 5).toFixed(3));
  assert.equal(f.median.toFixed(2), "17.75"); // even count: mean of 17.7 and 17.8
  // last five: 25.0 17.9 17.8 18.0 17.9 → median 17.9; first five: median 17.6 → +0.30
  assert.equal(f.lastFiveVsFirstFive?.toFixed(2), "0.30");
  // sorted: 17.5 17.6 17.6 17.6 17.7 17.8 17.9 17.9 18.0 25.0 → p10 = 17.5 (rank 1), p90 = 18.0 (rank 9)
  assert.equal(f.spread?.toFixed(2), "0.50");
});

test("figures: a race's opening lap from the grid is listed but left out of the figures", () => {
  // 7.11 in an 18-second class: the run from the grid to the line, as LiveRC prints it.
  const f = lapsFigures(laps(7.11, 19.3, 17.76, 17.66, 18.26, 17.98, 17.85, 17.69, 17.96, 18.04, 18.02));
  assert.ok(f);
  assert.equal(f.best, 17.66);
  assert.equal(f.partials, 1);
  // The ten real laps: first five's median 17.98, last five's 17.96.
  assert.equal(f.lastFiveVsFirstFive?.toFixed(2), (17.96 - 17.98).toFixed(2));
  const clean = lapsFigures(laps(17.5, 17.6, 17.7));
  assert.equal(clean?.partials, 0);
});

test("figures: under ten laps there is no first/last five; under five no spread; none for no laps", () => {
  const nine = lapsFigures(laps(17, 17, 17, 17, 17, 17, 17, 17, 17));
  assert.equal(nine?.lastFiveVsFirstFive, null);
  assert.equal(nine?.spread, 0);
  const four = lapsFigures(laps(17, 17, 17, 17));
  assert.equal(four?.spread, null);
  assert.equal(lapsFigures([]), null);
  assert.equal(lapsFigures([NaN, 0, -1]), null);
});

function session(over: Partial<LapsSession> & { drivers: LapsSession["drivers"] }): LapsSession {
  return { label: "Heat 2", className: "ISTC 13.5t", clock: "10:42", dateYmd: "2026-09-12", ...over };
}

test("render: sheet order kept, you marked, figures under every driver, practice explained", () => {
  const out = renderLapsBlock(
    [
      session({
        clock: "09:37",
        label: "Practice",
        className: null,
        drivers: [{ name: "you", isMe: true, laps: laps(17.72, 17.6, 17.65) }],
      }),
      session({
        drivers: [
          { name: "Timothy Hilyear", isMe: false, laps: laps(17.4, 17.3, 17.5) },
          { name: "Jordan Caruso", isMe: true, laps: laps(17.51, 17.39, 17.44) },
        ],
      }),
    ],
    "on 12 Sep 2026 at Radio Racing Cars SA"
  );
  assert.ok(out);
  assert.match(out, /^LAPS — every lap of every driver in the timed sessions you were in, on 12 Sep 2026 at Radio Racing Cars SA\./);
  const lines = out.split("\n");
  const practice = lines.findIndex((l) => l.startsWith("09:37  Practice  (1 driver)"));
  const heat = lines.findIndex((l) => l.startsWith("10:42  Heat 2 · ISTC 13.5t  (2 drivers)"));
  assert.ok(practice > 0 && heat > practice, "sessions in the order given, practice first");
  assert.equal(lines[practice + 1], "  you: 17.72 17.60 17.65", "a practice page's one driver is plain 'you'");
  assert.equal(lines[heat + 1], "  Timothy Hilyear: 17.40 17.30 17.50");
  assert.match(lines[heat + 2], /^ {6}best 17\.30 · top5 17\.40 · median 17\.40$/);
  assert.equal(lines[heat + 3], "  Jordan Caruso (you): 17.51 17.39 17.44");
  assert.match(out, /A session with one driver is a practice session/);
  assert.doesNotMatch(out, /could not be told apart/);
  // One day: no date on the session line.
  assert.doesNotMatch(out, /2026-09-12  10:42/);
});

test("render: a sheet with nobody matched says so; two days print their dates", () => {
  const out = renderLapsBlock(
    [
      session({
        dateYmd: "2026-09-11",
        drivers: [
          { name: "A", isMe: false, laps: laps(17, 17) },
          { name: "B", isMe: false, laps: laps(18, 18) },
        ],
      }),
      session({ dateYmd: "2026-09-12", drivers: [{ name: "Me", isMe: true, laps: laps(17, 17) }] }),
    ],
    "across the meeting"
  );
  assert.ok(out);
  assert.match(out, /could not be told apart by name or chip/);
  assert.match(out, /^2026-09-11  10:42  Heat 2/m);
  assert.match(out, /^2026-09-12  10:42  Heat 2/m);
});

test("render: nothing to show → null; sessions with no laps are skipped", () => {
  assert.equal(renderLapsBlock([], "x"), null);
  assert.equal(renderLapsBlock([session({ drivers: [{ name: "A", isMe: true, laps: [] }] })], "x"), null);
});

test("render: over the session cap the earliest are dropped and counted", () => {
  const many = Array.from({ length: MAX_LAPS_SESSIONS + 3 }, (_, i) =>
    session({ clock: `${String(8 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`, drivers: [{ name: "Me", isMe: true, laps: laps(17, 17) }] })
  );
  const out = renderLapsBlock(many, "x");
  assert.ok(out);
  assert.match(out, /The 3 earliest sessions are not shown\./);
  assert.doesNotMatch(out, /^08:00  /m);
  assert.match(out, /^08:45  /m);
});
